import { describe, expect, it } from "vitest";
import { DriftMonitor } from "../src/adapt/drift.js";
import { ClaudeOfferWriter, type OfferRequest } from "../src/connectors/ai/claude.js";
import { FakeClaude, type ClaudeAnswer } from "./fakes/claude.js";
import { FakeClock, seeded, testRuntime } from "./fakes/clock.js";

const REQ: OfferRequest = {
  store: "Nile Abayas", order: [{ title: "Abaya", quantity: 2 }], maxDiscountPct: 15,
  candidates: [
    { id: "c1", title: "Matching scarf", price: "150 ج.م.", margin: "high", boughtTogether: 7, popularity: 20 },
    { id: "c2", title: "Pin", price: "50 ج.م.", margin: "low", boughtTogether: 2, popularity: 40 },
  ],
};
function setup(seed = 1) {
  const clock = new FakeClock();
  const ai = new FakeClaude(clock, seeded(seed));
  const writer = new ClaudeOfferWriter({ apiKey: ai.apiKey, baseUrl: ai.baseUrl }, testRuntime(clock, { [ai.host]: ai.handler }, seeded(seed + 1)), new DriftMonitor());
  return { clock, ai, writer };
}

describe("Claude offer writer (E6-12)", () => {
  it("asks with structured output, the current model, fallbacks and low effort; returns a valid pick", async () => {
    const { ai, writer } = setup();
    const r = await writer.pickOffer(REQ);
    expect(r).toMatchObject({ reason: "ok", model: "claude-opus-5-5", usage: { input: 420, output: 95 }, pick: { id: "c1", discountPct: 10 } });
    expect(r.pick!.messageAr).toContain("{price}");
    const body = ai.requests[0]!;
    expect(body).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", output_config: { effort: "low", format: { type: "json_schema" } } });
    expect(body.output_config.format.schema.properties.id.enum).toEqual(["c1", "c2"]);
    expect(body.thinking).toBeUndefined(); // always on for this model; never disabled
  });

  it.each<[ClaudeAnswer, string]>([
    ["refusal", "refusal"], ["max_tokens", "max_tokens"], ["bad_json", "invalid"], ["invented", "invalid"],
    ["phone", "invalid"], ["over_discount", "invalid"], ["no_placeholder", "invalid"],
  ])("a %s answer gives no pick (%s): the caller keeps its own offer", async (answer, reason) => {
    const { ai, writer } = setup();
    ai.answers.push(answer);
    expect(await writer.pickOffer(REQ)).toMatchObject({ pick: null, reason });
  });

  it("keeps the owner's rule: the fixed item and discount, only the message is written", async () => {
    const { writer } = setup();
    expect((await writer.pickOffer({ ...REQ, fixed: { id: "c2", discountPct: 0 } })).pick).toMatchObject({ id: "c2", discountPct: 0 });
  });

  it("rides out 429 (retry-after), 529 and 500; a bad key stops", async () => {
    const { ai, writer, clock } = setup();
    ai.faults.push("429", "529");
    const t0 = clock.now();
    expect((await writer.pickOffer(REQ)).reason).toBe("ok");
    expect(clock.now() - t0).toBeGreaterThanOrEqual(3_000);
    const bad = new ClaudeOfferWriter({ apiKey: "nope", baseUrl: ai.baseUrl }, testRuntime(clock, { [ai.host]: ai.handler }), new DriftMonitor());
    await expect(bad.pickOffer(REQ)).rejects.toMatchObject({ kind: "auth", retryable: false });
  });

  it("sends no customer data: only the store, items, prices and margin bands", async () => {
    const { ai, writer } = setup();
    await writer.pickOffer(REQ);
    const sent = JSON.stringify(ai.requests[0]);
    expect(sent).not.toMatch(/Mona|\+20|01\d{9}|Abbas|@/);
  });

  it.each([0.1, 0.25, 0.5])("under chaos at %s: every answer is a valid pick, a clean null, or a classified error", async (rate) => {
    const { ai, writer } = setup(Math.round(rate * 100));
    ai.randomFaultRate = rate;
    let ok = 0;
    for (let i = 0; i < 30; i++) {
      try {
        const r = await writer.pickOffer(REQ);
        if (r.pick) { ok++; expect(["c1", "c2"]).toContain(r.pick.id); }
      } catch (e) {
        expect((e as { kind?: string }).kind).toMatch(/^(rate_limited|transient|timeout|circuit_open)$/);
      }
    }
    expect(ok).toBeGreaterThan(0);
  });
});
