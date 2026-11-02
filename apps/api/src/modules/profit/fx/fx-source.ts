import { CircuitBreaker, IntegrationError, send, type Runtime } from "@mizan/engine";
import { z } from "zod";

/** Daily rates against one base: 1 base = rates[quote] quote. Rates are decimal strings. */
export interface FxQuote {
  /** Calendar day (UTC) the provider published these rates for. */
  day: string;
  base: string;
  rates: Record<string, string>;
}

/** Where daily exchange rates come from. One implementation per feed; swap without touching callers. */
export interface FxSource {
  readonly name: string;
  /** Shown next to the rates where the feed's terms ask for it. */
  readonly attribution: string | null;
  latest(base: string): Promise<FxQuote>;
}

const OpenErApiResponse = z.object({
  result: z.literal("success"),
  base_code: z.string().regex(/^[A-Z]{3}$/),
  time_last_update_unix: z.number().int().positive(),
  rates: z.record(z.string(), z.number().positive()),
});

/** Decimal string from the feed's JSON number, at most 8 decimals (NUMERIC(18,8)); never exponent form. */
export function rateText(n: number): string {
  const s = n.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
  if (!/^\d+(\.\d+)?$/.test(s) || /^0(\.0+)?$/.test(s)) throw new RangeError(`unusable rate ${n}`);
  return s;
}

/**
 * open.er-api.com (ExchangeRate-API's free tier): no key, updated daily, "latest" only. Terms:
 * attribution required, rate limited (one call a day per base is plenty). Through the engine's
 * send(): timeout, retries with backoff, circuit breaker (CLAUDE.md rule 4).
 */
export class OpenErApiSource implements FxSource {
  readonly name = "open-er-api";
  readonly attribution = "Rates by ExchangeRate-API (exchangerate-api.com)";
  private readonly circuit: CircuitBreaker;

  constructor(private readonly rt: Runtime, private readonly baseUrl = "https://open.er-api.com/v6/latest") {
    this.circuit = new CircuitBreaker("fx:open-er-api", rt.clock, { failureThreshold: 3, openMs: 15 * 60_000 });
  }

  async latest(base: string): Promise<FxQuote> {
    const res = await send(this.rt, { connector: "fx", op: "fx.latest", method: "GET", url: `${this.baseUrl}/${encodeURIComponent(base)}`, idempotent: true, maxAttempts: 3, timeoutMs: 10_000 }, { circuit: this.circuit });
    const parsed = OpenErApiResponse.safeParse(res.json);
    if (!parsed.success) throw new IntegrationError({ kind: "schema_drift", connector: "fx", message: `unexpected FX payload: ${parsed.error.issues[0]?.message ?? "invalid"}` });
    const rates: Record<string, string> = {};
    for (const [code, value] of Object.entries(parsed.data.rates)) if (/^[A-Z]{3}$/.test(code)) rates[code] = rateText(value);
    return { day: new Date(parsed.data.time_last_update_unix * 1000).toISOString().slice(0, 10), base: parsed.data.base_code, rates };
  }
}

/** Tests and local development: fixed rates, optionally failing. */
export class FakeFxSource implements FxSource {
  readonly name = "fake";
  readonly attribution = null;
  calls = 0;
  fail = false;
  constructor(public rates: Record<string, string>, public day?: string) {}
  async latest(base: string): Promise<FxQuote> {
    this.calls++;
    if (this.fail) throw new Error("fx feed down");
    return { day: this.day ?? new Date().toISOString().slice(0, 10), base, rates: this.rates };
  }
}
