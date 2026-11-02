import { IntegrationError, kindFromStatus, parseRetryAfter, type ErrorKind } from "../../core/errors.js";
import type { Runtime } from "../../core/runtime.js";
import type { DriftSink } from "../../adapt/drift.js";
import { Resolver } from "../../adapt/resolve.js";
import { CircuitBreaker } from "../../resilience/circuit.js";
import { send, type HttpResponse } from "../../resilience/http.js";
import { AdaptiveBucket } from "../../resilience/limiter.js";

/**
 * Claude (Anthropic Messages API), E6-12: picks the add-on offer among Mizan's candidates and
 * writes it for the WhatsApp chat in Egyptian Arabic and English.
 *
 * - Raw HTTP through `send()` (rule 4: breaker, rate bucket, error taxonomy) rather than the SDK.
 * - Structured output (`output_config.format`, JSON schema) and `fallbacks: "default"` so a
 *   safety decline is retried server-side on the recommended model. A refusal, a cut-off answer
 *   or anything that does not validate returns null: the caller keeps its own offer and wording.
 * - What is sent: the store's name, product titles, prices, quantities and margin bands. Never
 *   the customer's name, phone or address (docs/07). Nothing is logged but counts and ids.
 */
export interface ClaudeConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /** How hard to think: picking one of a few items is a "low" task. */
  effort?: "low" | "medium" | "high";
  timeoutMs?: number;
}

export const CLAUDE_DEFAULT_MODEL = "claude-opus-5-5";
export const ANTHROPIC_VERSION = "2026-10-21";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** Longest message we accept, per language (fits a WhatsApp button message with room to spare). */
export const OFFER_MESSAGE_MAX = 160;

export interface OfferCandidateForAi {
  /** Our id for the item (opaque to the model). */
  id: string;
  title: string;
  /** "135 ج.م." as the customer will see it, before any discount the model chooses. */
  price: string;
  /** high | medium | low | unknown: how much the store keeps on it. */
  margin: "high" | "medium" | "low" | "unknown";
  /** Orders that had it together with this order's items, recently. */
  boughtTogether: number;
  popularity: number;
}

export interface OfferRequest {
  store: string;
  /** The order's items as the customer named them. */
  order: Array<{ title: string; quantity: number }>;
  candidates: OfferCandidateForAi[];
  /** The model may not go above this. */
  maxDiscountPct: number;
  /** When the owner's rule fixed the item and the discount: write the message only. */
  fixed?: { id: string; discountPct: number };
}

export interface OfferPick {
  id: string;
  discountPct: number;
  /** With the placeholder {price} where the price goes (the caller fills it in). */
  messageAr: string;
  messageEn: string;
}

export interface OfferResult {
  pick: OfferPick | null;
  /** Why there is no pick (refusal, max_tokens, invalid …) — for metrics. */
  reason: "ok" | "refusal" | "max_tokens" | "invalid";
  model: string | null;
  usage: { input: number; output: number };
}

const SYSTEM = [
  "You choose one add-on item to offer a customer who has just confirmed an order with an online store in Egypt, and you write the short WhatsApp message that offers it.",
  "Choose only from the candidates given, by their id. Prefer an item that completes or goes with what is in the order; then one customers often buy with it; avoid low-margin items when a good alternative exists.",
  "discountPct is a whole number from 0 to the maximum given. Use a discount only when it helps; 0 is fine.",
  "If the request says the item is fixed, keep that id and discount and only write the messages.",
  "messageAr: Egyptian colloquial Arabic, warm and short. messageEn: the same in English. Each at most 160 characters, at most one emoji.",
  "Write {price} exactly where the price goes; do not write any number for the price yourself. Name the item. No links, no phone numbers, no pressure or false scarcity, no claims about the product that are not in its title.",
].join("\n");

const SCHEMA = (ids: string[]) => ({
  type: "object",
  properties: {
    id: { type: "string", enum: ids },
    discountPct: { type: "integer" },
    messageAr: { type: "string" },
    messageEn: { type: "string" },
  },
  required: ["id", "discountPct", "messageAr", "messageEn"],
  additionalProperties: false,
});

const KINDS: Record<string, ErrorKind> = {
  rate_limit_error: "rate_limited",
  overloaded_error: "transient",
  api_error: "transient",
  timeout_error: "timeout",
  authentication_error: "auth",
  permission_error: "permission",
  billing_error: "permission",
  invalid_request_error: "validation",
  not_found_error: "validation",
  request_too_large: "validation",
};

export class ClaudeOfferWriter {
  readonly circuit: CircuitBreaker;
  readonly bucket: AdaptiveBucket;

  constructor(private readonly cfg: ClaudeConfig, private readonly rt: Runtime, private readonly drift: DriftSink) {
    this.circuit = new CircuitBreaker("claude", rt.clock, { failureThreshold: 5, openMs: 60_000 });
    this.bucket = new AdaptiveBucket(rt.clock, { capacity: 10, refillPerSec: 2 });
  }

  get model(): string {
    return this.cfg.model ?? CLAUDE_DEFAULT_MODEL;
  }

  async pickOffer(req: OfferRequest): Promise<OfferResult> {
    if (!req.candidates.length) return { pick: null, reason: "invalid", model: null, usage: { input: 0, output: 0 } };
    const ids = req.candidates.map((c) => c.id);
    const res = await send(this.rt, {
      connector: "claude", op: "claude.pickOffer", method: "POST", url: `${(this.cfg.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "")}/v1/messages`,
      headers: { "x-api-key": this.cfg.apiKey, "anthropic-version": ANTHROPIC_VERSION, "anthropic-beta": FALLBACK_BETA },
      body: {
        model: this.model, max_tokens: 4000, fallbacks: "default",
        output_config: { effort: this.cfg.effort ?? "low", format: { type: "json_schema", schema: SCHEMA(ids) } },
        system: SYSTEM,
        messages: [{ role: "user", content: JSON.stringify({ store: req.store, order: req.order, candidates: req.candidates, maxDiscountPct: req.maxDiscountPct, ...(req.fixed ? { fixed: req.fixed } : {}) }) }],
      },
      // A generation changes nothing anywhere: asking again after a timeout only costs tokens.
      idempotent: true, maxAttempts: 3, timeoutMs: this.cfg.timeoutMs ?? 30_000,
      classify: (r) => this.classify(r),
    }, { circuit: this.circuit, bucket: this.bucket });

    const r = new Resolver(res.json, { connector: "claude", entity: "message", drift: this.drift, now: () => this.rt.clock.now() });
    const usage = { input: r.num("inputTokens", ["usage.input_tokens"]) ?? 0, output: r.num("outputTokens", ["usage.output_tokens"]) ?? 0 };
    const model = r.str("model", ["model"]) ?? null;
    const stop = r.str("stopReason", ["stop_reason"]);
    if (stop === "refusal") return { pick: null, reason: "refusal", model, usage };
    if (stop === "max_tokens") return { pick: null, reason: "max_tokens", model, usage };
    const text = r.arr<{ type?: string; text?: string }>("content", ["content"]).filter((b) => b?.type === "text").map((b) => b.text ?? "").join("");
    const pick = validate(text, req);
    return { pick, reason: pick ? "ok" : "invalid", model, usage };
  }

  private classify(res: HttpResponse): IntegrationError | null {
    const type = (res.json as { error?: { type?: string } } | undefined)?.error?.type;
    const kind = (type ? KINDS[type] : undefined) ?? (res.status === 529 ? "transient" : kindFromStatus(res.status));
    return new IntegrationError({
      kind, connector: "claude", status: res.status, message: `claude.pickOffer: ${type ?? `HTTP ${res.status}`}`,
      retryAfterMs: parseRetryAfter(res.headers.get("retry-after"), this.rt.clock.now()),
      details: { type, requestId: res.headers.get("request-id") },
    });
  }
}

/** The model's answer, only if every rule holds; otherwise null and the caller keeps its own. */
export function validate(text: string, req: OfferRequest): OfferPick | null {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return null; }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = o.id;
  const pct = o.discountPct;
  const ar = typeof o.messageAr === "string" ? o.messageAr.trim() : "";
  const en = typeof o.messageEn === "string" ? o.messageEn.trim() : "";
  if (typeof id !== "string" || !req.candidates.some((c) => c.id === id)) return null; // never an item we did not offer
  if (typeof pct !== "number" || !Number.isInteger(pct) || pct < 0 || pct > req.maxDiscountPct) return null;
  if (req.fixed && (id !== req.fixed.id || pct !== req.fixed.discountPct)) return null; // the owner's rule stands
  for (const m of [ar, en]) {
    if (!m || [...m].length > OFFER_MESSAGE_MAX + 10) return null; // {price} is replaced by a short amount
    if (!m.includes("{price}")) return null;
    if (/https?:\/\/|www\.|\b\d{7,}\b|[٠-٩]{7,}/i.test(m)) return null; // no links, no phone numbers
  }
  return { id, discountPct: pct, messageAr: ar, messageEn: en };
}
