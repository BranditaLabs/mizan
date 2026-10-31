import type { User } from "firebase/auth";
import createClient, { type Client, type Middleware } from "openapi-fetch";
import type { components, paths } from "./schema";

/**
 * The typed API client (E4-4): paths, bodies and responses come from apps/api/openapi.json
 * (`npm run gen:api -w @mizan/web`), so a renamed field or a new role is a compile error here.
 *
 *   const { data } = await ok(api.GET("/v1/me"));
 *   await ok(api.POST("/v1/tenants", { body, headers: idempotency(key) }));
 */
export type Schemas = components["schemas"];
export type Me = Schemas["Me"];
export type Membership = Me["memberships"][number];
export type MyInvitation = Me["invitations"][number];
export type Tenant = Schemas["Tenant"];
export type Problem = Schemas["ProblemDetails"];
export type MemberRole = Membership["role"];
export type ApiClient = Client<paths>;

/** The API origin (CORS allows the web app's origin). */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

/**
 * An RFC 9457 problem from the API. `code` is stable (switch on it); `title` is already in the
 * caller's language (the API localises it from Accept-Language). `status` 0 = no answer (network).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly detail?: string,
    readonly errors?: Problem["errors"],
    readonly requestId?: string,
  ) {
    super(`${status} ${code}`);
    this.name = "ApiError";
  }

  static from(status: number, body: unknown): ApiError {
    const p = (body && typeof body === "object" ? body : {}) as Partial<Problem>;
    return new ApiError(status, p.code ?? "unknown", p.title ?? "", p.detail, p.errors, p.requestId);
  }
}

export interface ApiContext {
  user: User | null;
  locale: string;
  /** The store requests are for (X-Tenant-Id); a call can set its own header instead. */
  tenantId?: string | null;
  /** Test seam. */
  fetch?: typeof fetch;
}

/** Bearer token (refreshed by Firebase before expiry), language, store and a fallback idempotency key. */
function contextMiddleware(ctx: ApiContext): Middleware {
  return {
    async onRequest({ request }) {
      if (ctx.user) request.headers.set("Authorization", `Bearer ${await ctx.user.getIdToken()}`);
      request.headers.set("Accept-Language", ctx.locale);
      if (ctx.tenantId && !request.headers.has("X-Tenant-Id")) request.headers.set("X-Tenant-Id", ctx.tenantId);
      // Callers pass a key that stays the same across retries (see idempotency()); this one only covers a single attempt.
      if (request.method === "POST" && !request.headers.has("Idempotency-Key")) request.headers.set("Idempotency-Key", crypto.randomUUID());
      return request;
    },
    async onResponse({ response }) {
      // A token the API calls expired (clock skew): force a fresh one so the retry policy's next attempt passes.
      if (response.status === 401 && ctx.user) {
        const p = (await response.clone().json().catch(() => ({}))) as Partial<Problem>;
        if (p.code === "token_expired") await ctx.user.getIdToken(true).catch(() => undefined);
      }
      return response;
    },
  };
}

/** A client bound to a person, a language and (optionally) a store. Cheap: create one per context. */
export function apiClient(ctx: ApiContext): ApiClient {
  const client = createClient<paths>({ baseUrl: API_URL, ...(ctx.fetch ? { fetch: ctx.fetch } : {}) });
  client.use(contextMiddleware(ctx));
  return client;
}

/** Headers that make a create safe to retry (docs/05 Idempotency-Key). */
export const idempotency = (key: string) => ({ "Idempotency-Key": key });

/** The data of a successful call, or an ApiError (a problem, or status 0 when there was no answer). */
export async function ok<T>(call: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  let result: Awaited<typeof call>;
  try {
    result = await call;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(0, "network", "");
  }
  if (result.response.ok) return result.data as T;
  throw ApiError.from(result.response.status, result.error);
}
