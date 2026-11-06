import { describe, expect, it } from "vitest";
import {
  cannotAdd, idMaker, insertStep, LANE_SLACK, laneIndex, lastMovable, MAX_STEPS, moveStep, normalize, removeStep, setWait, stepsValid, withIds, withoutIds, type Channel, type FlowStep,
} from "../src/components/studio/flow";
import { forReason, forText, knownCode, mergeIssues, refusedTexts, targetOf, textUnchanged, toIssues } from "../src/components/studio/issues";
import { estimateLength, insertAt, missingRequired, notAllowed, variablesIn } from "../src/components/studio/length";
import { keysOf, nodeOf } from "../src/components/studio/nodes";
import { keep, nextStep, reveal, simulate, START, visibleTurns, type SimConversation, type SimState } from "../src/components/studio/simulation";
import { parseWhatsApp, plainText } from "../src/components/studio/whatsapp-format";

const ids = idMaker("s");
const step = (channel: Channel, waitMinutes = 60): FlowStep => ({ id: ids(), channel, waitMinutes });
const chans = (s: readonly FlowStep[]) => s.map((x) => x.channel);

describe("studio flow: the cascade's rules (E6-16b)", () => {
  it("inserts before the team call, which stays last; a team call goes to the end", () => {
    const base = [step("whatsapp"), step("call_team")];
    expect(chans(insertStep(base, step("call_auto")))).toEqual(["whatsapp", "call_auto", "call_team"]);
    expect(chans(insertStep(base, step("call_auto"), 0))).toEqual(["call_auto", "whatsapp", "call_team"]);
    expect(chans(insertStep(base, step("call_auto"), 9))).toEqual(["whatsapp", "call_auto", "call_team"]); // never after the team call
    expect(chans(insertStep([step("whatsapp")], step("call_team"), 0))).toEqual(["whatsapp", "call_team"]);
    expect(chans(insertStep(base, step("call_team")))).toEqual(["whatsapp", "call_team"]); // one team call
  });

  it("at most six steps; the reason a chip is disabled", () => {
    let s: FlowStep[] = [step("whatsapp")];
    for (let i = 0; i < 10; i++) s = insertStep(s, step("call_auto"));
    expect(s).toHaveLength(MAX_STEPS);
    expect(cannotAdd(s, "whatsapp")).toBe("full");
    expect(cannotAdd([step("call_team")], "call_team")).toBe("team_exists");
    expect(cannotAdd([step("whatsapp")], "call_team")).toBeNull();
  });

  it("moves steps but never the team call, and nothing past it", () => {
    const s = [step("whatsapp"), step("call_auto"), step("whatsapp", 30), step("call_team")];
    expect(lastMovable(s)).toBe(2);
    expect(chans(moveStep(s, 0, 2))).toEqual(["call_auto", "whatsapp", "whatsapp", "call_team"]);
    expect(moveStep(s, 0, 3).map((x) => x.id)).toEqual([s[1]!.id, s[2]!.id, s[0]!.id, s[3]!.id]);
    expect(moveStep(s, 3, 0)).toEqual(s); // the team call is pinned
    expect(chans(moveStep(s, 2, 0))).toEqual(["whatsapp", "whatsapp", "call_auto", "call_team"]);
    expect(moveStep(s, 1, 1)).toEqual(s);
  });

  it("removes, keeping one step; sets the wait; validates like the API", () => {
    const s = [step("whatsapp"), step("call_team")];
    expect(chans(removeStep(s, 0))).toEqual(["call_team"]);
    expect(removeStep([s[0]!], 0)).toHaveLength(1);
    expect(stepsValid(s)).toBe(true);
    expect(stepsValid(setWait(s, 0, 5))).toBe(false);
    expect(stepsValid(setWait(s, 0, 1441))).toBe(false);
    expect(stepsValid([s[1]!, s[0]!])).toBe(false);
    expect(stepsValid([])).toBe(false);
    expect(chans(normalize([s[1]!, s[0]!, step("call_team")]))).toEqual(["whatsapp", "call_team"]);
  });

  it("ids are stable and never reused; they never reach the API", () => {
    const next = idMaker("r", ["r1", "r3"]);
    expect([next(), next(), next()]).toEqual(["r2", "r4", "r5"]);
    const s = withIds([{ channel: "whatsapp", waitMinutes: 120 }], idMaker("s"));
    expect(s).toEqual([{ id: "s1", channel: "whatsapp", waitMinutes: 120 }]);
    expect(withoutIds(s)).toEqual([{ channel: "whatsapp", waitMinutes: 120 }]);
  });
});

describe("the live counter counts like the API (validate.ts estimateLength)", () => {
  const widths = { "order.items": 200, "customer.first_name": 20, "order.number": 16 };
  it("matches the API's examples", () => {
    expect(estimateLength("{{order.items}}", widths)).toBe(200);
    expect(estimateLength("{{store.name}}!", widths, "Nile")).toBe(5);
    expect(estimateLength("{{store.name}}", widths)).toBe(1);
    expect(estimateLength("Hi {{ customer.first_name }}, {{order.number}}", widths)).toBe(3 + 20 + 2 + 16);
    expect(estimateLength("{{customer.phone}}", widths)).toBe("{{customer.phone}}".length); // unknown: counted as typed
    expect(estimateLength("و".repeat(850) + " {{order.items}}", new Map(Object.entries(widths)))).toBe(1051);
  });

  it("reads variables, required ones and those not allowed", () => {
    expect(variablesIn("{{a.b}} x {{a.b}} {{c}}")).toEqual(["a.b", "c"]);
    expect(missingRequired("Pay {{summary.due}}", ["summary.due"])).toEqual([]);
    expect(missingRequired("Pay later", ["summary.due"])).toEqual(["summary.due"]);
    expect(notAllowed("{{order.number}} {{link}}", ["order.number"])).toEqual(["link"]);
  });

  it("inserts a variable at the caret, over a selection, with a space after a word", () => {
    expect(insertAt("Hi ", "{{x}}", 3)).toEqual({ value: "Hi {{x}}", caret: 8 });
    expect(insertAt("Hi Mona!", "{{x}}", 3, 7)).toEqual({ value: "Hi {{x}}!", caret: 8 });
    expect(insertAt("Hi", "{{x}}", 2)).toEqual({ value: "Hi {{x}}", caret: 8 });
    expect(insertAt("", "{{x}}", 5)).toEqual({ value: "{{x}}", caret: 5 });
    expect(insertAt("أهلاً", "{{x}}", 5).value).toBe("أهلاً {{x}}");
  });
});

describe("WhatsApp formatting", () => {
  const p = parseWhatsApp;
  it("bold, italic, strike and monospace", () => {
    expect(p("*hi*")).toEqual([{ type: "bold", children: [{ type: "text", text: "hi" }] }]);
    expect(p("a _b_ ~c~")).toEqual([{ type: "text", text: "a " }, { type: "italic", children: [{ type: "text", text: "b" }] }, { type: "text", text: " " }, { type: "strike", children: [{ type: "text", text: "c" }] }]);
    expect(p("```*x* _y_```")).toEqual([{ type: "mono", text: "*x* _y_" }]);
  });

  it("nests, and keeps markers that do not open or close as typed", () => {
    expect(p("*bold _both_*")).toEqual([{ type: "bold", children: [{ type: "text", text: "bold " }, { type: "italic", children: [{ type: "text", text: "both" }] }] }]);
    expect(plainText(p("2*3*4"))).toBe("2*3*4"); // inside a word
    expect(p("* not bold*")).toEqual([{ type: "text", text: "* not bold*" }]);
    expect(p("*open")).toEqual([{ type: "text", text: "*open" }]);
    expect(p("**")).toEqual([{ type: "text", text: "**" }]);
    expect(p("snake_case_name")).toEqual([{ type: "text", text: "snake_case_name" }]);
    expect(p("*تم* ✅")).toEqual([{ type: "bold", children: [{ type: "text", text: "تم" }] }, { type: "text", text: " ✅" }]);
  });

  it("line breaks, and formatting never crosses a line", () => {
    expect(p("a\nb")).toEqual([{ type: "text", text: "a" }, { type: "br" }, { type: "text", text: "b" }]);
    expect(p("*a\nb*")).toEqual([{ type: "text", text: "*a" }, { type: "br" }, { type: "text", text: "b*" }]);
  });

  it("links, without the punctuation after them", () => {
    expect(p("Go: https://app.mizan.test/c/x.")).toEqual([{ type: "text", text: "Go: " }, { type: "link", href: "https://app.mizan.test/c/x", text: "https://app.mizan.test/c/x" }, { type: "text", text: "." }]);
    expect(p("www.example.com")).toEqual([{ type: "link", href: "https://www.example.com", text: "www.example.com" }]);
    expect(p("*see https://x.io*")).toEqual([{ type: "bold", children: [{ type: "text", text: "see " }, { type: "link", href: "https://x.io", text: "https://x.io" }] }]);
    expect(p("javascript:alert(1)")).toEqual([{ type: "text", text: "javascript:alert(1)" }]);
  });

  it("HTML stays text (the phone renders nodes, never markup)", () => {
    expect(p("<b>x</b><script>alert(1)</script>")).toEqual([{ type: "text", text: "<b>x</b><script>alert(1)</script>" }]);
  });
});

describe("the phone's simulation", () => {
  const tpl = { from: "business", kind: "template", buttons: ["Confirm", "Change", "Cancel"] } as const;
  const convs: SimConversation[] = [
    { scenario: "confirm", turns: [tpl, { from: "customer", kind: "tap", text: "Confirm" }, { from: "business", kind: "text", key: "confirmed" }] },
    { scenario: "confirm_offer", turns: [tpl, { from: "customer", kind: "tap", text: "Confirm" }, { from: "business", kind: "buttons", key: "offer_pitch", buttons: ["Add it", "No thanks"] }, { from: "customer", kind: "tap", text: "Add it" }, { from: "business", kind: "text", key: "offer_added" }] },
    { scenario: "offer_no", turns: [tpl, { from: "customer", kind: "tap", text: "Confirm" }, { from: "business", kind: "buttons", key: "offer_pitch", buttons: ["Add it", "No thanks"] }, { from: "customer", kind: "tap", text: "No thanks" }, { from: "business", kind: "text", key: "offer_declined" }] },
    { scenario: "change", turns: [tpl, { from: "customer", kind: "tap", text: "Change" }, { from: "business", kind: "text", key: "change_prompt" }, { from: "customer", kind: "typed", text: "Size L?" }, { from: "business", kind: "text", key: "change_received" }] },
    { scenario: "cancel", turns: [tpl, { from: "customer", kind: "tap", text: "Too pricey" }, { from: "business", kind: "list", key: "cancel_prompt", list: { button: "Choose", rows: [{ title: "Too pricey" }, { title: "Keep it" }] } }, { from: "customer", kind: "tap", text: "Too pricey" }, { from: "business", kind: "text", key: "cancelled" }] },
    { scenario: "message", turns: [tpl, { from: "customer", kind: "typed", text: "When?" }, { from: "business", kind: "text", key: "noted" }] },
    { scenario: "already", turns: [tpl, { from: "customer", kind: "tap", text: "Confirm" }, { from: "business", kind: "text", key: "confirmed" }, { from: "customer", kind: "tap", text: "Cancel" }, { from: "business", kind: "text", key: "already" }] },
    { scenario: "opt_out", turns: [tpl, { from: "customer", kind: "typed", text: "STOP" }, { from: "business", kind: "text", key: "opted_out" }] },
  ];
  const go = (s: SimState, a: Parameters<typeof simulate>[2]) => simulate(convs, s, a).state;

  it("starts with the template alone; a tap plays its scenario", () => {
    expect(visibleTurns(convs, START)).toHaveLength(1);
    expect(simulate(convs, START, { type: "template", index: 0, offer: false })).toEqual({ state: { scenario: "confirm", shown: 3 }, animate: true });
    expect(go(START, { type: "template", index: 0, offer: true })).toEqual({ scenario: "confirm_offer", shown: 3 });
    expect(go(START, { type: "template", index: 1, offer: false })).toEqual({ scenario: "change", shown: 3 });
    expect(go(START, { type: "template", index: 2, offer: false })).toEqual({ scenario: "cancel", shown: 3 });
  });

  it("the offer: Yes adds it, No thanks plays the declined reply", () => {
    const s = go(START, { type: "template", index: 0, offer: true });
    expect(nextStep(convs, s)).toEqual({ kind: "tap", on: 2, expect: "Add it" });
    expect(go(s, { type: "button", turn: 2, index: 0 })).toEqual({ scenario: "confirm_offer", shown: 5 });
    expect(go(s, { type: "button", turn: 2, index: 1 })).toEqual({ scenario: "offer_no", shown: 5 });
    expect(simulate(convs, s, { type: "button", turn: 0, index: 0 })).toMatchObject({ nowhere: true }); // not the turn waiting for a tap
  });

  it("the cancel list: any row, then the reply, with the chosen title", () => {
    const s = go(START, { type: "template", index: 2, offer: false });
    expect(go(s, { type: "list", turn: 2, title: "Keep it" })).toEqual({ scenario: "cancel", shown: 5, chosen: { at: 3, title: "Keep it" } });
  });

  it("typed steps from the composer; quick replies jump to their scenario", () => {
    const s = go(START, { type: "template", index: 1, offer: false });
    expect(nextStep(convs, s)).toEqual({ kind: "typed", text: "Size L?" });
    expect(go(s, { type: "compose", reply: "next" })).toEqual({ scenario: "change", shown: 5 });
    expect(simulate(convs, START, { type: "compose", reply: "next" })).toMatchObject({ nowhere: true });
    expect(go(START, { type: "compose", reply: "message" })).toEqual({ scenario: "message", shown: 3 });
    expect(go(START, { type: "compose", reply: "opt_out" })).toEqual({ scenario: "opt_out", shown: 3 });
    expect(simulate(convs, START, { type: "compose", reply: "opt_in" })).toMatchObject({ nowhere: true }); // not in this preview
  });

  it("Cancel after confirming answers 'already'; jump shows a whole chat; restart", () => {
    const s = go(START, { type: "template", index: 0, offer: false });
    const late = go(s, { type: "template", index: 2, offer: false });
    expect(late).toEqual({ scenario: "confirm", shown: 3, late: [{ label: "Cancel", reply: true }] });
    expect(visibleTurns(convs, late).map((x) => [x.from, x.key ?? x.text])).toEqual([
      ["business", undefined], ["customer", "Confirm"], ["business", "confirmed"], ["customer", "Cancel"], ["business", "already"],
    ]);
    expect(simulate(convs, START, { type: "jump", scenario: "cancel" })).toEqual({ state: { scenario: "cancel", shown: 5 }, animate: false });
    expect(go(s, { type: "restart" })).toEqual(START);
  });

  it("after an answer the template never replays a scenario: another answer gets 'already', the same one nothing (whatsapp-chat.service onTap)", () => {
    const confirmed = go(START, { type: "template", index: 0, offer: false });
    // Change after Confirm: "already", never the change prompt.
    const change = simulate(convs, confirmed, { type: "template", index: 1, offer: false });
    expect(change).toEqual({ state: { scenario: "confirm", shown: 3, late: [{ label: "Change", reply: true }] }, animate: true });
    expect(visibleTurns(convs, change.state).at(-1)?.key).toBe("already");
    expect(nextStep(convs, change.state)).toBeNull();
    // Confirm again: the buyer's tap, no reply.
    const again = simulate(convs, confirmed, { type: "template", index: 0, offer: false });
    expect(again).toEqual({ state: { scenario: "confirm", shown: 3, late: [{ label: "Confirm", reply: false }] }, animate: false });
    expect(visibleTurns(convs, again.state).map((x) => x.from)).toEqual(["business", "customer", "business", "customer"]);
    // Confirm after a change, and after a cancel with its reason: "already".
    const changed = go(START, { type: "template", index: 1, offer: false });
    expect(go(changed, { type: "template", index: 0, offer: false }).late).toEqual([{ label: "Confirm", reply: true }]);
    expect(go(changed, { type: "template", index: 1, offer: false }).late).toEqual([{ label: "Change", reply: false }]);
    const cancelled = go(go(START, { type: "template", index: 2, offer: false }), { type: "list", turn: 2, title: "Too pricey" });
    expect(go(cancelled, { type: "template", index: 0, offer: false }).late).toEqual([{ label: "Confirm", reply: true }]);
    // Cancel opens the list only: the run is still open, Confirm there confirms.
    expect(go(go(START, { type: "template", index: 2, offer: false }), { type: "template", index: 0, offer: false })).toEqual({ scenario: "confirm", shown: 3 });
    // The late taps survive a new preview.
    expect(keep(convs, change.state)).toEqual(change.state);
  });

  it("reveal: a key not in the chat moves the phone to the sample that has it, up to its bubble", () => {
    expect(reveal(convs, START, ["cancelled"])).toEqual({ scenario: "cancel", shown: 5 });
    expect(reveal(convs, START, ["offer_pitch"])).toEqual({ scenario: "confirm_offer", shown: 3 });
    expect(reveal(convs, { scenario: "cancel", shown: 5 }, ["cancelled"])).toBeNull(); // on screen
    expect(reveal(convs, START, ["summary_pay"], "confirm")).toEqual({ scenario: "confirm", shown: 3 }); // no bubble of its own
    expect(reveal(convs, START, ["link_text"])).toBeNull();
  });

  it("keeps the position on a new preview, clamped", () => {
    expect(keep(convs, { scenario: "change", shown: 9 })).toEqual({ scenario: "change", shown: 5 });
    expect(keep(convs.slice(0, 1), { scenario: "change", shown: 3 })).toEqual(START);
    expect(keep(convs, START)).toEqual(START);
  });
});

describe("issues land on their field", () => {
  it("preview paths (inside the script) and 422 paths (from the settings root)", () => {
    expect(targetOf(["texts", "ar", "confirmed"], true)).toEqual({ area: "text", lang: "ar", key: "confirmed" });
    expect(targetOf("script.texts.en.btn_offer_yes", false)).toEqual({ area: "text", lang: "en", key: "btn_offer_yes" });
    expect(targetOf("script.cancelReasons.2.title.ar", false)).toEqual({ area: "reason", index: 2, field: "title", lang: "ar" });
    expect(targetOf(["cancelReasons", 0, "id"], true)).toEqual({ area: "reason", index: 0, field: "id", lang: null });
    expect(targetOf("script.cancelReasons", false)).toEqual({ area: "reasons" });
    expect(targetOf("steps.1.waitMinutes", false)).toEqual({ area: "steps", index: 1 });
    expect(targetOf("steps", false)).toEqual({ area: "steps", index: null });
    expect(targetOf("callingHours", false)).toEqual({ area: "team" });
    expect(targetOf("routing.autoMax", false)).toEqual({ area: "other" });
    expect(targetOf("script.pack", false)).toEqual({ area: "script" });
  });

  it("filters per text and reason; words the codes it knows", () => {
    const issues = toIssues([
      { path: "script.texts.ar.confirmed", code: "too_long", limit: 1000, length: 1200 },
      { path: "script.cancelReasons.1.title", code: "reason_title_required" },
      { path: "script.cancelReasons.1.title.en", code: "duplicate_title" },
    ], false);
    expect(forText(issues, "ar", "confirmed")).toEqual([{ target: { area: "text", lang: "ar", key: "confirmed" }, code: "too_long", limit: 1000, length: 1200 }]);
    expect(forText(issues, "en", "confirmed")).toEqual([]);
    expect(forReason(issues, 1, "ar").map((i) => i.code)).toEqual(["reason_title_required"]);
    expect(forReason(issues, 1, "en").map((i) => i.code)).toEqual(["reason_title_required", "duplicate_title"]);
    expect(knownCode("too_long")).toBe("too_long");
    expect(knownCode("too_big")).toBe("other");
  });

  it("a refused save and the live preview report the same problem once", () => {
    const saved = toIssues([{ path: "script.texts.ar.confirmed", code: "no_links" }, { path: "steps.0.waitMinutes", code: "too_small" }], false);
    const live = toIssues([{ path: ["texts", "ar", "confirmed"], code: "no_links" }, { path: ["texts", "en", "confirmed"], code: "no_links" }], true);
    const merged = mergeIssues(saved, live);
    expect(merged).toHaveLength(3);
    expect(forText(merged, "ar", "confirmed")).toHaveLength(1);
    expect(mergeIssues(toIssues([{ path: "script.texts.ar.cancelled", code: "variable_not_here", variable: "order.items" }, { path: "script.texts.ar.cancelled", code: "variable_not_here", variable: "order.total" }], false))).toHaveLength(2);
  });
});

describe("what blocks Save: only texts the draft changed, like the API (confirmation.service unchanged)", () => {
  const keys = [{ key: "confirmed", limit: 20, required: ["order.number"] }, { key: "cancelled", limit: 20, required: [] }];
  const widths = { "order.number": 6 };
  const long = "{{order.number}} at {{store.name}}"; // 6 + 4 + store name
  const stored = { ar: { confirmed: long } };

  it("a stored text that no longer fits (the store was renamed) never blocks saving the rest", () => {
    expect(refusedTexts({ draft: stored, stored, keys, widths, storeName: "A much longer store name" })).toEqual([]);
    expect(refusedTexts({ draft: { ar: { confirmed: ` ${long} ` } }, stored, keys, widths, storeName: "A much longer store name" })).toEqual([]); // trimmed, as the API
    expect(textUnchanged(stored, stored, "ar", "confirmed")).toBe(true);
  });

  it("a changed text over its limit, missing a required variable, or flagged by the preview blocks", () => {
    const storeName = "A much longer store name";
    expect(refusedTexts({ draft: { ar: { confirmed: `${long}!` } }, stored, keys, widths, storeName })).toEqual([{ lang: "ar", key: "confirmed" }]);
    expect(refusedTexts({ draft: { ar: { confirmed: long }, en: { confirmed: "Thanks" } }, stored, keys, widths, storeName })).toEqual([{ lang: "en", key: "confirmed" }]);
    const flagged = toIssues([{ path: ["texts", "ar", "cancelled"], code: "no_links" }, { path: ["texts", "ar", "confirmed"], code: "too_long" }], true);
    expect(refusedTexts({ draft: { ar: { confirmed: long, cancelled: "see x.com" } }, stored, keys, widths, storeName, issues: flagged })).toEqual([{ lang: "ar", key: "cancelled" }]);
  });
});

describe("dropping a palette chip into the lane", () => {
  // A WhatsApp card (0-60) with its tall branch grid under it (to 700), then the team call card (720-780).
  const cards = [{ top: 0, bottom: 60 }, { top: 720, bottom: 780 }];
  const lane = { top: 0, bottom: 800 };

  it("lands by the step cards' middles, never the branch grid's", () => {
    expect(laneIndex(10, cards, lane, 1)).toBe(0);
    expect(laneIndex(70, cards, lane, 1)).toBe(1); // just under the WhatsApp card: after it
    expect(laneIndex(400, cards, lane, 1)).toBe(1);
  });

  it("never after the team call; outside the lane, nowhere; a lone team call still takes a drop", () => {
    expect(laneIndex(790, cards, lane, 1)).toBe(1);
    expect(laneIndex(lane.bottom + LANE_SLACK + 1, cards, lane, 1)).toBeNull();
    expect(laneIndex(-LANE_SLACK - 1, cards, lane, 1)).toBeNull();
    expect(laneIndex(50, [{ top: 0, bottom: 60 }], { top: 0, bottom: 80 }, 0)).toBe(0);
    expect(laneIndex(50, [{ top: 0, bottom: 60 }], { top: 0, bottom: 80 }, 1)).toBe(1);
  });
});

describe("every key has a node", () => {
  it("groups map to nodes; the shared groups' own keys go where the buyer meets them", () => {
    expect(nodeOf("confirmed", "confirmation")).toBe("confirms");
    expect(nodeOf("summary_pay", "summary")).toBe("confirms");
    expect(nodeOf("noted", "summary")).toBe("message");
    expect(nodeOf("already", "summary")).toBe("again");
    expect(nodeOf("opted_in", "system")).toBe("stop");
    expect(nodeOf("footer", "system")).toBe("every");
    expect(nodeOf("call", "calls")).toBe("team");
    expect(keysOf([{ key: "footer", group: "system" }, { key: "opted_out", group: "system" }, { key: "link_text", group: "system" }], "every").map((k) => k.key)).toEqual(["footer", "link_text"]);
  });
});
