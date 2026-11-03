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

  async savePicture(trx: Transaction<DB>, tenantId: string, folder: string, bytes: Buffer): Promise<SavedPicture> {
    if (bytes.length === 0) throw new ProblemError(422, "picture_empty", "the picture is empty");
    if (bytes.length > this.config.MEDIA_MAX_BYTES) throw new ProblemError(413, "picture_too_large", `pictures up to ${Math.floor(this.config.MEDIA_MAX_BYTES / 1048576)} MB`);
    if (!SIGNATURES.some((s) => s.test(bytes))) throw new ProblemError(415, "picture_type", "a JPEG, PNG or WebP picture");
    let meta: Metadata;
    try {
      meta = await sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error" }).metadata();
    } catch {
      throw new ProblemError(422, "picture_unreadable", "the picture could not be read, or has more than 40 million pixels");
    }
    // Upright sides (EXIF orientation 5–8 swap them).
    const [w, h] = (meta.orientation ?? 1) >= 5 ? [meta.height ?? 0, meta.width ?? 0] : [meta.width ?? 0, meta.height ?? 0];
    if (w < MIN_SIDE || h < MIN_SIDE) throw new ProblemError(422, "picture_too_small", `pictures at least ${MIN_SIDE} × ${MIN_SIDE} pixels`);

    const encode = (px: number) => sharp(bytes, { limitInputPixels: MAX_PIXELS }).rotate().resize({ width: px, height: px, fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer({ resolveWithObject: true });
    const [full, thumb] = await Promise.all([encode(FULL_PX), encode(THUMB_PX)]);
    const name = randomUUID();
    const store = async (key: string, out: { data: Buffer; info: { width: number; height: number } }) => {
      if (this.blob) await this.blob.put(`${tenantId}/${key}`, out.data, "image/webp");
      const row = await trx.insertInto("media_objects").values({
        tenant_id: tenantId, key, content_type: "image/webp", bytes: out.data.length, width: out.info.width, height: out.info.height,
        storage: this.blob ? "blob" : "db", data: this.blob ? null : out.data,
      }).returning("id").executeTakeFirstOrThrow();
      return { id: row.id, url: this.url(tenantId, key), width: out.info.width, height: out.info.height };
    };
    const savedFull = await store(`${folder}/${name}.webp`, full);
    const savedThumb = await store(`${folder}/${name}_${THUMB_PX}.webp`, thumb);
    return { full: savedFull, thumb: { id: savedThumb.id, url: savedThumb.url } };
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

  /** A picture and its thumbnail, gone (the row first; a Blob left behind is only space). */
  async remove(trx: Transaction<DB>, tenantId: string, ids: string[]): Promise<void> {
    if (!ids.length) return;
    const rows = await trx.deleteFrom("media_objects").where("id", "in", ids).returning(["key", "storage"]).execute();
    for (const r of rows) if (r.storage === "blob" && this.blob) await this.blob.remove(`${tenantId}/${r.key}`).catch(() => undefined);
  }
}
