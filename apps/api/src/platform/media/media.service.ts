import { randomUUID } from "node:crypto";
import { Inject, Injectable, Optional } from "@nestjs/common";
import type { Transaction } from "kysely";
import sharp, { type Metadata } from "sharp";
import type { DB } from "@mizan/db";
import { APP_CONFIG, type AppConfig } from "../config.js";
import { Database } from "../db/database.js";
import { ProblemError } from "../http/problem.js";
import { BlobStore } from "./blob-store.js";

/** The Blob container client, when MEDIA_BLOB_URL is set (provided by MediaModule). */
export const BLOB_STORE = Symbol("BLOB_STORE");

/** What a person may upload: the file's own bytes decide, never its name or declared type. */
const SIGNATURES: Array<{ type: string; test: (b: Buffer) => boolean }> = [
  { type: "jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: "webp", test: (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" },
];
/** Larger pictures are scaled down; a store shows nothing bigger. */
const FULL_PX = 2048;
const THUMB_PX = 400;
/** Decompression bombs: refused before they are decoded. */
const MAX_PIXELS = 40_000_000;
const MIN_SIDE = 200;
/** Pictures decoding at once per instance (sharp has a few threads; more would only queue). */
const MAX_ENCODING = 3;

/** A picture checked, encoded and (with Blob) stored, waiting for its rows. */
export interface PreparedPicture {
  tenantId: string;
  files: Array<{ key: string; data: Buffer; width: number; height: number }>;
}

export interface SavedPicture {
  full: { id: string; url: string; width: number; height: number };
  thumb: { id: string; url: string };
}

/**
 * Pictures uploaded to Mizan (P3). Each is checked (a JPEG, PNG or WebP by its bytes, a size, not
 * too many pixels, not too small), turned upright and re-encoded as WebP without its metadata (GPS
 * and camera data never leave), as the picture (2048 px at most) and a 400 px thumbnail. The bytes go
 * to Blob Storage when it is configured, else into the database; both are public by URL
 * (/media/<tenant>/<key>), as a store shows them to everyone.
 */
@Injectable()
export class MediaService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Database) private readonly db: Database,
    @Optional() @Inject(BLOB_STORE) private readonly blob: BlobStore | null = null,
  ) {}

  /** The public address of a stored file. */
  url(tenantId: string, key: string): string {
    return `${this.config.PUBLIC_URL.replace(/\/$/, "")}/media/${tenantId}/${key}`;
  }

  /** Pictures decoding at once on this instance: more wait for a moment (503), so uploads never starve the rest. */
  private encoding = 0;

  /**
   * Check and encode a picture, then keep its two files where pictures live — all before any
   * database transaction (a big photo takes seconds; a connection is never held for it). The rows
   * that point at the files are written by `record`, in the caller's transaction; if that fails,
   * `discard` removes the files again.
   */
  async prepare(tenantId: string, folder: string, bytes: Buffer): Promise<PreparedPicture> {
    if (bytes.length === 0) throw new ProblemError(422, "picture_empty", "the picture is empty");
    if (bytes.length > this.config.MEDIA_MAX_BYTES) throw new ProblemError(413, "picture_too_large", `pictures up to ${Math.floor(this.config.MEDIA_MAX_BYTES / 1048576)} MB`);
    if (!SIGNATURES.some((s) => s.test(bytes))) throw new ProblemError(415, "picture_type", "a JPEG, PNG or WebP picture");
    if (this.encoding >= MAX_ENCODING) throw new ProblemError(503, "busy", "pictures are being processed: try again in a moment");
    this.encoding++;
    try {
      let meta: Metadata;
      try {
        meta = await sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error" }).metadata();
      } catch {
        throw new ProblemError(422, "picture_unreadable", "the picture could not be read, or has more than 40 million pixels");
      }
      // Upright sides (EXIF orientation 5–8 swap them).
      const [w, h] = (meta.orientation ?? 1) >= 5 ? [meta.height ?? 0, meta.width ?? 0] : [meta.width ?? 0, meta.height ?? 0];
      if (w < MIN_SIDE || h < MIN_SIDE) throw new ProblemError(422, "picture_too_small", `pictures at least ${MIN_SIDE} × ${MIN_SIDE} pixels`);
      // The first frame only (an animated picture is one picture here), metadata never copied.
      const encode = (px: number) => sharp(bytes, { limitInputPixels: MAX_PIXELS, pages: 1 }).rotate().resize({ width: px, height: px, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
      const [full, thumb] = await Promise.all([encode(FULL_PX), encode(THUMB_PX)]);
      const name = randomUUID();
      const files = [
        { key: `${folder}/${name}.webp`, data: full.data, width: full.info.width, height: full.info.height },
        { key: `${folder}/${name}_${THUMB_PX}.webp`, data: thumb.data, width: thumb.info.width, height: thumb.info.height },
      ] as const;
      if (this.blob) {
        try {
          for (const f of files) await this.blob.put(`${tenantId}/${f.key}`, f.data, "image/webp");
        } catch (e) {
          await this.purge(tenantId, files.map((f) => f.key));
          throw e;
        }
      }
      return { tenantId, files: [...files] };
    } finally {
      this.encoding--;
    }
  }

  /** The rows for a prepared picture, in the caller's transaction. */
  async record(trx: Transaction<DB>, prepared: PreparedPicture): Promise<SavedPicture> {
    const [full, thumb] = await Promise.all(prepared.files.map(async (f) => {
      const row = await trx.insertInto("media_objects").values({
        tenant_id: prepared.tenantId, key: f.key, content_type: "image/webp", bytes: f.data.length, width: f.width, height: f.height,
        storage: this.blob ? "blob" : "db", data: this.blob ? null : f.data,
      }).returning("id").executeTakeFirstOrThrow();
      return { id: row.id, url: this.url(prepared.tenantId, f.key), width: f.width, height: f.height };
    }));
    return { full: full!, thumb: { id: thumb!.id, url: thumb!.url } };
  }

  /** A prepared picture whose rows were never written: its files go (best effort; a leftover is only space). */
  async discard(prepared: PreparedPicture): Promise<void> {
    if (this.blob) await this.purge(prepared.tenantId, prepared.files.map((f) => f.key));
  }

  /** A stored file, for the public route; null when there is none. */
  async read(tenantId: string, key: string): Promise<{ bytes: Buffer; contentType: string } | null> {
    const row = await this.db.tenant(tenantId, (trx) => trx.selectFrom("media_objects").select(["content_type", "storage", "data"]).where("key", "=", key).executeTakeFirst());
    if (!row) return null;
    if (row.storage === "db") return row.data ? { bytes: Buffer.from(row.data), contentType: row.content_type } : null;
    if (!this.blob) return null;
    const bytes = await this.blob.get(`${tenantId}/${key}`);
    return bytes ? { bytes, contentType: row.content_type } : null;
  }

  /**
   * A picture and its thumbnail: their rows go in the caller's transaction; the Blob keys come back,
   * to `purge` once it has committed (a rollback then never leaves a row pointing at nothing).
   */
  async remove(trx: Transaction<DB>, ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const rows = await trx.deleteFrom("media_objects").where("id", "in", ids).returning(["key", "storage"]).execute();
    return rows.filter((r) => r.storage === "blob").map((r) => r.key);
  }

  /** Blob files no row points at any more (best effort). */
  async purge(tenantId: string, keys: readonly string[]): Promise<void> {
    if (!this.blob) return;
    for (const k of keys) await this.blob.remove(`${tenantId}/${k}`).catch(() => undefined);
  }
}
