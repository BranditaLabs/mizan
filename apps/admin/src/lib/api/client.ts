import type { User } from "firebase/auth";
import createClient, { type Client, type Middleware } from "openapi-fetch";
import type { components, paths } from "./schema";

/**
 * The typed API client for the back office: the same openapi.json as the dashboard, used only for
 * /v1/platform/* (no store header: staff act through the back office's own role).
 */
export type Schemas = components["schemas"];
export type Problem = Schemas["ProblemDetails"];
export type ApiClient = Client<paths>;
export type StaffRole = Schemas["StaffMe"]["role"];

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

/** An RFC 9457 problem from the API (`title` already in the caller's language). `status` 0 = no answer. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly title: string, readonly detail?: string) {
    super(`${status} ${code}`);
    this.name = "ApiError";
  }

  static from(status: number, body: unknown): ApiError {
    const p = (body && typeof body === "object" ? body : {}) as Partial<Problem>;
    return new ApiError(status, p.code ?? "unknown", p.title ?? "", p.detail);
  }
}

function contextMiddleware(user: User | null, locale: string): Middleware {
  return {
    async onRequest({ request }) {
      if (user) request.headers.set("Authorization", `Bearer ${await user.getIdToken()}`);
      request.headers.set("Accept-Language", locale);
      if (request.method === "POST" && !request.headers.has("Idempotency-Key")) request.headers.set("Idempotency-Key", crypto.randomUUID());
      return request;
    },
  };
}

export function apiClient(user: User | null, locale: string, fetchImpl?: typeof fetch): ApiClient {
  const client = createClient<paths>({ baseUrl: API_URL, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  client.use(contextMiddleware(user, locale));
  return client;
}

/** The data of a successful call, or an ApiError. */
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
