import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/lib/api/client";
import { makeQueryClient } from "../src/lib/api/query";
import { apiReady, isOutage, nextCheckIn } from "../src/lib/outage";

describe("outage", () => {
  it("is no answer or a gateway that says the API is down, never a 4xx or a route's own 500", () => {
    for (const s of [0, 502, 503, 504]) expect(isOutage(new ApiError(s, "x", ""))).toBe(true);
    for (const s of [400, 401, 403, 404, 409, 429, 500]) expect(isOutage(new ApiError(s, "x", ""))).toBe(false);
    expect(isOutage(new Error("boom"))).toBe(false);
  });

  it("checks again after 5, 10, 20, then every 30 seconds", () => {
    expect([0, 1, 2, 3, 4, 9].map(nextCheckIn)).toEqual([5, 10, 20, 30, 30, 30]);
  });

  it("is over when /health/ready answers 2xx; an error answer or no answer keeps it on", async () => {
    const seen: string[] = [];
    const answer = (r: Response | Error) => vi.fn(async (url: RequestInfo | URL) => { seen.push(String(url)); if (r instanceof Error) throw r; return r; });
    expect(await apiReady(answer(new Response("{}", { status: 200 })) as typeof fetch)).toBe(true);
    expect(await apiReady(answer(new Response("{}", { status: 503 })) as typeof fetch)).toBe(false);
    expect(await apiReady(answer(new TypeError("Failed to fetch")) as typeof fetch)).toBe(false);
    expect(seen[0]).toMatch(/\/health\/ready$/);
  });

  it("an outage goes to the waiting screen instead of a toast; other failures still toast", async () => {
    const notify = vi.fn();
    const outage = vi.fn();
    const client = makeQueryClient(notify, outage);
    const fail = (e: unknown) => client.getMutationCache().build(client, { mutationFn: async () => { throw e; }, retry: false }).execute(undefined).catch(() => undefined);
    await fail(new ApiError(0, "network", ""));
    await fail(new ApiError(503, "unavailable", ""));
    expect(notify).not.toHaveBeenCalled();
    await fail(new ApiError(409, "conflict", "Already exists"));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(outage).toHaveBeenCalledTimes(3); // it hears every failure and decides itself
  });
});
