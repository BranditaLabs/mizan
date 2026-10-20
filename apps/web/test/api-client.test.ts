import type { User } from "firebase/auth";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { generate, OUT } from "../scripts/gen-api.mjs";
import { apiClient, ApiError, idempotency, ok } from "../src/lib/api/client";
import { makeQueryClient, problemText, shouldRetry } from "../src/lib/api/query";

const problem = (status: number, code: string, title = "") =>
  new Response(JSON.stringify({ type: `https://docs.mizan.app/errors/${code}`, title, status, code }), { status, headers: { "Content-Type": "application/problem+json" } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fakeUser = () => ({ getIdToken: vi.fn(async (force?: boolean) => (force ? "fresh-token" : "token")) }) as unknown as User & { getIdToken: ReturnType<typeof vi.fn> };

describe("generated API types", () => {
  it("src/lib/api/schema.d.ts matches apps/api/openapi.json (run `npm run gen:api -w @mizan/web`)", async () => {
    expect(readFileSync(OUT, "utf8")).toBe(await generate());
  });
});

describe("api client", () => {
  it("sends the token, language, store and an idempotency key on POST; keeps a caller's own key and store", async () => {
    const seen: Request[] = [];
    const fetch = vi.fn(async (r: RequestInfo | URL) => { seen.push(r as Request); return json({ ok: true }); });
    const api = apiClient({ user: fakeUser(), locale: "ar", tenantId: "11111111-1111-4111-8111-111111111111", fetch });
    await api.GET("/v1/members");
    await api.POST("/v1/members/invite", { body: { role: "agent", phone: "01001234821" } });
    await api.POST("/v1/tenants", { body: { name: "Nile", country: "EG", language: "ar" }, headers: { ...idempotency("key-1"), "X-Tenant-Id": "22222222-2222-4222-8222-222222222222" } });
    expect(seen[0]!.headers.get("Authorization")).toBe("Bearer token");
    expect(seen[0]!.headers.get("Accept-Language")).toBe("ar");
    expect(seen[0]!.headers.get("X-Tenant-Id")).toBe("11111111-1111-4111-8111-111111111111");
    expect(seen[0]!.headers.get("Idempotency-Key")).toBeNull(); // reads need none
    expect(seen[1]!.headers.get("Idempotency-Key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(seen[2]!.headers.get("Idempotency-Key")).toBe("key-1");
    expect(seen[2]!.headers.get("X-Tenant-Id")).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("ok() returns data, turns problems into ApiError and no answer into status 0", async () => {
    const answers = [json({ status: "ok" }), problem(403, "mfa_required", "لازم تفعّل التحقق بخطوتين")];
    const api = apiClient({ user: fakeUser(), locale: "ar", fetch: async () => answers.shift()! });
    expect(await ok(api.GET("/v1/tenant"))).toEqual({ status: "ok" });
    const err = await ok(api.GET("/v1/tenant")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: "mfa_required", title: "لازم تفعّل التحقق بخطوتين" });
    const offline = apiClient({ user: null, locale: "en", fetch: async () => { throw new TypeError("Failed to fetch"); } });
    expect(await ok(offline.GET("/v1/me")).catch((e: unknown) => e)).toMatchObject({ status: 0, code: "network" });
  });

  it("an expired token is refreshed so the retry passes", async () => {
    const user = fakeUser();
    const api = apiClient({ user, locale: "en", fetch: async () => problem(401, "token_expired") });
    await ok(api.GET("/v1/me")).catch(() => undefined);
    expect(user.getIdToken).toHaveBeenCalledWith(true);
  });
});

describe("retry and error policy", () => {
  it("retries only what can succeed on its own, at most twice", () => {
    const e = (status: number, code = "x") => new ApiError(status, code, "");
    expect(shouldRetry(0, e(0, "network"))).toBe(true);
    expect(shouldRetry(0, e(503))).toBe(true);
    expect(shouldRetry(0, e(429, "rate_limited"))).toBe(true);
    expect(shouldRetry(0, e(401, "token_expired"))).toBe(true);
    expect(shouldRetry(0, e(401, "token_invalid"))).toBe(false);
    expect(shouldRetry(0, e(403, "mfa_required"))).toBe(false);
    expect(shouldRetry(0, e(422, "validation_failed"))).toBe(false);
    expect(shouldRetry(2, e(503))).toBe(false);
    expect(shouldRetry(0, new Error("bug"))).toBe(false);
  });

  it("shows the API's title, or our words when there was no usable answer", () => {
    const t = (k: "network" | "generic") => `t:${k}`;
    expect(problemText(new ApiError(409, "slug_taken", "عنوان المتجر ده مستخدم"), t)).toBe("عنوان المتجر ده مستخدم");
    expect(problemText(new ApiError(0, "network", ""), t)).toBe("t:network");
    expect(problemText(new ApiError(500, "unknown", ""), t)).toBe("t:generic");
    expect(problemText(new Error("x"), t)).toBe("t:generic");
  });

  it("toasts failed actions and failed refreshes of data on screen, not first loads or opted-out calls", async () => {
    const notify = vi.fn();
    const qc = makeQueryClient(notify);
    const fail = () => Promise.reject(new ApiError(409, "conflict", "تعارض"));
    await qc.getMutationCache().build(qc, { mutationFn: fail, retry: false }).execute(undefined).catch(() => undefined);
    expect(notify).toHaveBeenCalledTimes(1);
    await qc.getMutationCache().build(qc, { mutationFn: fail, retry: false, meta: { toast: false } }).execute(undefined).catch(() => undefined);
    expect(notify).toHaveBeenCalledTimes(1);
    await qc.fetchQuery({ queryKey: ["first"], queryFn: fail, retry: false }).catch(() => undefined);
    expect(notify).toHaveBeenCalledTimes(1); // the screen shows a first-load error itself
    qc.setQueryData(["shown"], { n: 1 });
    await qc.fetchQuery({ queryKey: ["shown"], queryFn: fail, retry: false, staleTime: 0 }).catch(() => undefined);
    expect(notify).toHaveBeenCalledTimes(2);
  });
});
