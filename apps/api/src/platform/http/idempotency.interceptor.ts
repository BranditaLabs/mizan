import { createHash } from "node:crypto";
import { Inject, Injectable, SetMetadata, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Response } from "express";
import { setActingUser } from "@mizan/db";
import { from, mergeMap, Observable, of, throwError, catchError } from "rxjs";
import type { AuthedRequest } from "../auth/auth.types.js";
import { Database } from "../db/database.js";
import { ProblemError } from "./problem.js";

export const IDEMPOTENCY_TTL_MS = 24 * 3600_000;
const KEY = /^[\x21-\x7e]{1,255}$/;
const NOT_STORED = "mizan:idempotencyNotStored";

/**
 * For POST routes whose response must never be stored or replayed (decrypted personal data,
 * reads that must be audited each time): the Idempotency-Key header is ignored there.
 */
export const NoIdempotency = () => SetMetadata(NOT_STORED, true);

/**
 * Idempotency-Key on POST (docs/05): the same key with the same request returns
 * the first response (`Idempotency-Replayed: true`) without running the handler
 * again; the same key with a different request is a 409. Keys are per caller,
 * kept 24 h. Only successful responses are stored: a failed attempt can be
 * retried with the same key.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(Database) private readonly db: Database, @Inject(Reflector) private readonly reflector: Reflector) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const key = req.headers["idempotency-key"];
    if (req.method !== "POST" || key === undefined || !req.auth) return next.handle();
    if (this.reflector.getAllAndOverride<boolean>(NOT_STORED, [ctx.getHandler(), ctx.getClass()])) return next.handle();
    if (typeof key !== "string" || !KEY.test(key)) {
      return throwError(() => new ProblemError(400, "invalid_idempotency_key", "Idempotency-Key must be 1–255 visible ASCII characters"));
    }
    const res = ctx.switchToHttp().getResponse<Response>();
    const actorId = req.auth.user.id;
    const tenantId = req.auth.tenant?.id ?? null;
    const hash = createHash("sha256").update(JSON.stringify([req.method, req.originalUrl, tenantId, req.body ?? null])).digest("hex");

    return from(this.claim(actorId, key, tenantId, hash)).pipe(
      mergeMap((claim) => {
        if (claim.replay) {
          res.setHeader("Idempotency-Replayed", "true");
          res.status(claim.replay.status);
          return of(claim.replay.body ?? undefined);
        }
        return next.handle().pipe(
          mergeMap(async (body) => {
            await this.finish(actorId, key, res.statusCode, body);
            return body;
          }),
          catchError((err) => from(this.release(actorId, key)).pipe(mergeMap(() => throwError(() => err)))),
        );
      }),
    );
  }

  /** Claim the key, or return the stored response. */
  private async claim(actorId: string, key: string, tenantId: string | null, hash: string): Promise<{ replay?: { status: number; body: unknown } }> {
    return this.db.platform(async (trx) => {
      await setActingUser(trx, actorId);
      const now = new Date();
      await trx.deleteFrom("idempotency_keys").where("key", "=", key).where("expires_at", "<", now).execute();
      const inserted = await trx.insertInto("idempotency_keys").values({
        actor_id: actorId, key, tenant_id: tenantId, request_hash: hash, status: "in_progress",
        expires_at: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
      }).onConflict((oc) => oc.columns(["actor_id", "key"]).doNothing()).returning("key").executeTakeFirst();
      if (inserted) return {};
      const existing = await trx.selectFrom("idempotency_keys").select(["request_hash", "status", "response_status", "response_body"])
        .where("key", "=", key).executeTakeFirstOrThrow();
      if (existing.request_hash !== hash) {
        throw new ProblemError(409, "idempotency_key_reused", "this Idempotency-Key was used for a different request");
      }
      if (existing.status !== "done") {
        throw new ProblemError(409, "idempotency_key_in_progress", "the first request with this Idempotency-Key is still running; retry shortly");
      }
      const body = typeof existing.response_body === "string" ? JSON.parse(existing.response_body) : existing.response_body;
      return { replay: { status: existing.response_status ?? 200, body } };
    });
  }

  private async finish(actorId: string, key: string, status: number, body: unknown): Promise<void> {
    await this.db.platform(async (trx) => {
      await setActingUser(trx, actorId);
      await trx.updateTable("idempotency_keys").set({
        status: "done", response_status: status, response_body: body === undefined ? null : JSON.stringify(body),
      }).where("key", "=", key).execute();
    });
  }

  private async release(actorId: string, key: string): Promise<void> {
    await this.db.platform(async (trx) => {
      await setActingUser(trx, actorId);
      await trx.deleteFrom("idempotency_keys").where("key", "=", key).where("status", "=", "in_progress").execute();
    });
  }
}
