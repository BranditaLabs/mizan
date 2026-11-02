import { hang, json, type FakeClock } from "./clock.js";

/**
 * In-memory Anthropic Messages API for the offer writer (E6-12). By default it answers like the
 * model would: the first candidate (or the fixed one), the max discount capped at 10, and
 * messages with {price}. Scripted answers and faults reproduce what the real API does: 429 with
 * retry-after, 529 overloaded, 500, a hang, a refusal (HTTP 200), a cut-off answer, broken JSON,
 * an invented item, a message with a phone number. Every request is kept so tests can check
 * that no customer data was sent.
 */
type Fault = "429" | "529" | "500" | "timeout" | "network";
export type ClaudeAnswer = "ok" | "refusal" | "max_tokens" | "bad_json" | "invented" | "phone" | "over_discount" | "no_placeholder";

export class FakeClaude {
  readonly host = "fake-anthropic.test";
  readonly apiKey = "sk-ant-test-key";
  readonly requests: Array<Record<string, any>> = [];
  faults: Fault[] = [];
  answers: ClaudeAnswer[] = [];
  randomFaultRate = 0;

  constructor(private readonly clock: FakeClock, private readonly random: () => number = Math.random) {}

  get baseUrl() { return `https://${this.host}`; }

  private err(status: number, type: string, headers: Record<string, string> = {}) {
    return json(status, { type: "error", error: { type, message: `fake ${type}` } }, { "request-id": "req_fake", ...headers });
  }

  handler = async (url: URL, init: RequestInit): Promise<Response> => {
    const h = init.headers as Record<string, string>;
    if (h["x-api-key"] !== this.apiKey) return this.err(401, "authentication_error");
    if (!h["anthropic-version"]) return this.err(400, "invalid_request_error");
    let fault = this.faults.shift();
    if (!fault && this.randomFaultRate && this.random() < this.randomFaultRate) fault = (["429", "529", "500", "timeout", "network"] as Fault[])[Math.floor(this.random() * 5)];
    if (fault === "429") return this.err(429, "rate_limit_error", { "retry-after": "3" });
    if (fault === "529") return this.err(529, "overloaded_error");
    if (fault === "500") return this.err(500, "api_error");
    if (fault === "network") throw new TypeError("fetch failed: socket hang up");
    if (fault === "timeout") return hang(init);
    if (url.pathname !== "/v1/messages") return this.err(404, "not_found_error");
    const body = JSON.parse(String(init.body));
    this.requests.push(body);
    const input = JSON.parse(body.messages[0].content);
    const first = input.fixed?.id ?? input.candidates[0].id;
    const pct = input.fixed?.discountPct ?? Math.min(10, input.maxDiscountPct);
    let out: Record<string, unknown> = { id: first, discountPct: pct, messageAr: "🎁 كمّلي اللوك بـ {price} بس", messageEn: "🎁 Complete the look for just {price}" };
    let stop = "end_turn";
    const answer = this.answers.shift() ?? "ok";
    if (answer === "refusal") { stop = "refusal"; out = {}; }
    if (answer === "max_tokens") stop = "max_tokens";
    if (answer === "invented") out.id = "not-a-candidate";
    if (answer === "phone") out.messageAr = "كلّمنا على 01001234567 والسعر {price}";
    if (answer === "over_discount") out.discountPct = input.maxDiscountPct + 5;
    if (answer === "no_placeholder") out.messageEn = "Complete the look for EGP 99";
    const text = answer === "bad_json" ? "{\"id\": " : answer === "refusal" ? "" : JSON.stringify(out);
    return json(200, {
      id: `msg_${this.requests.length}`, type: "message", role: "assistant", model: body.model, stop_reason: stop,
      stop_details: stop === "refusal" ? { type: "refusal", category: null, explanation: "declined" } : null,
      content: [{ type: "thinking", thinking: "" }, ...(text ? [{ type: "text", text }] : [])],
      usage: { input_tokens: 420, output_tokens: 95 },
    }, { "request-id": `req_${this.requests.length}` });
  };
}
