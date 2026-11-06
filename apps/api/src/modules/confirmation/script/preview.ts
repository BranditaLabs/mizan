import { chatContent, TEMPLATE_TEXT, whatsappParams, type ChatMessage, type MessageFacts, type OfferFacts } from "../messages.js";
import type { PREVIEW_SCENARIOS, PreviewTurn } from "../confirmation.dto.js";
import type { ScriptKey } from "./catalogue.js";

type Scenario = (typeof PREVIEW_SCENARIOS)[number];

/** What the buyer types in the samples. */
const TYPED = {
  ar: { change: "ممكن المقاس يبقى L بدل M؟", message: "هو الأوردر هيوصل إمتى؟", stop: "إيقاف", start: "ابدأ" },
  en: { change: "Can I have size L instead of M?", message: "When will my order arrive?", stop: "STOP", start: "START" },
} as const;

/**
 * The phone preview (E6-16a): one chat per scenario, the Meta-approved template first (not
 * editable), the buyer's taps and words, then the store's replies as WhatsApp would show them.
 */
export function previewConversations(f: MessageFacts, sampleOffer: OfferFacts): Array<{ scenario: Scenario; turns: PreviewTurn[] }> {
  const tpl = TEMPLATE_TEXT[f.lang];
  const params = whatsappParams(f);
  const template: PreviewTurn = { from: "business", kind: "template", editable: false, body: tpl.body.replace(/\{\{(\d)\}\}/g, (_, i: string) => params[Number(i) - 1] ?? ""), buttons: [...tpl.buttons] };
  const tap = (text: string): PreviewTurn => ({ from: "customer", kind: "tap", editable: false, text });
  const typed = (text: string): PreviewTurn => ({ from: "customer", kind: "typed", editable: false, text });
  const reply = (m: ChatMessage, key: ScriptKey, facts = f): PreviewTurn => {
    const c = chatContent(m, facts);
    if (c.type === "text") return { from: "business", kind: "text", key, editable: true, text: c.text, length: c.text.length };
    const frame = { ...(c.header ? { header: c.header.text } : {}), ...(c.footer ? { footer: c.footer } : {}) };
    if (c.type === "buttons") return { from: "business", kind: "buttons", key, editable: true, ...frame, body: c.body, buttons: c.buttons.map((b) => b.title), length: c.body.length };
    return {
      from: "business", kind: "list", key, editable: true, ...frame, body: c.body, length: c.body.length,
      list: { button: c.button, ...(c.section ? { section: c.section } : {}), rows: c.rows.map((r) => ({ title: r.title, ...(r.description ? { description: r.description } : {}) })) },
    };
  };
  const withOffer = { ...f, offer: sampleOffer };
  const offered = chatContent("confirmed_offer", withOffer);
  const cancel = chatContent("cancel_reasons", f);
  const t = TYPED[f.lang];
  return [
    { scenario: "confirm", turns: [template, tap(tpl.buttons[0]), reply("confirmed", "confirmed")] },
    { scenario: "confirm_offer", turns: [template, tap(tpl.buttons[0]), reply("confirmed_offer", "offer_pitch", withOffer), tap(offered.type === "buttons" ? offered.buttons[0]!.title : ""), reply("offer_added", "offer_added", withOffer)] },
    { scenario: "offer_no", turns: [template, tap(tpl.buttons[0]), reply("confirmed_offer", "offer_pitch", withOffer), tap(offered.type === "buttons" ? offered.buttons[1]!.title : ""), reply("offer_declined", "offer_declined", withOffer)] },
    { scenario: "change", turns: [template, tap(tpl.buttons[1]), reply("change_prompt", "change_prompt"), typed(t.change), reply("change_received", "change_received")] },
    { scenario: "cancel", turns: [template, tap(tpl.buttons[2]), reply("cancel_reasons", "cancel_prompt"), tap(cancel.type === "list" ? cancel.rows[0]!.title : ""), reply("cancelled", "cancelled")] },
    { scenario: "message", turns: [template, typed(t.message), reply("noted", "noted")] },
    { scenario: "already", turns: [template, tap(tpl.buttons[0]), reply("confirmed", "confirmed"), tap(tpl.buttons[2]), reply("already", "already")] },
    { scenario: "opt_out", turns: [template, typed(t.stop), reply("opted_out", "opted_out")] },
    { scenario: "opt_in", turns: [template, typed(t.start), reply("opted_in", "opted_in")] },
  ];
}
