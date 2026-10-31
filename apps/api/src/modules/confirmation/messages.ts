import type { Money } from "@mizan/shared";
import { render, scriptText, type Script, type ScriptKey } from "./script.js";

/**
 * What the customer receives (E6-7, E6-10), in Egyptian Arabic or English (the store's language).
 * Only the store's name, the first name, the order number, the items and the amount: never the
 * address or phone. The WhatsApp templates must be approved by Meta with the wording in
 * docs/modules/M02 §Templates; the replies inside the chat are free-form (no approval needed).
 */
export interface MessageFacts {
  lang: "ar" | "en";
  store: string;
  firstName: string | null;
  number: string;
  /** What the customer pays the courier (0 when prepaid). */
  cod: Money;
  total: Money;
  /** The hand-sent confirm link (manual flow only). */
  link: string;
  items?: Array<{ title: string; quantity: number }>;
  city?: string | null;
  /** The run's offer while it is open (E6-11). */
  offer?: OfferFacts | null;
  /** The store's script (E6-5): its wording wins over the built-in messages. */
  script?: Script;
}

export interface OfferFacts {
  id: string;
  title: string;
  qty: number;
  /** For one, after the discount. */
  price: Money;
  /** Before the discount, when there is one. */
  was: Money | null;
  /** The owner's wording for this offer, in the store's language. */
  message: string | null;
  /** What the customer pays in total with the offer added. */
  newTotal: Money;
}

/** "1,250 ج.م." / "EGP 1,250": plain text (no direction marks, Western digits). */
export function money(m: Money, lang: "ar" | "en"): string {
  const [int = "0", frac = ""] = m.amount.replace(/^-/, "").split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const n = /^0*$/.test(frac) ? grouped : `${grouped}.${frac}`;
  if (lang === "en") return `${m.currency} ${n}`;
  return m.currency === "EGP" ? `${n} ج.م.` : `${n} ${m.currency}`;
}

const hello = (f: Pick<MessageFacts, "lang" | "firstName">) => (f.lang === "ar" ? (f.firstName ? `أهلاً ${f.firstName}` : "أهلاً بيك") : f.firstName ? `Hi ${f.firstName}` : "Hi");
const due = (f: MessageFacts) => (Number(f.cod.amount) > 0 ? f.cod : f.total);
const payNote = (f: MessageFacts) => (Number(f.cod.amount) > 0 ? (f.lang === "ar" ? " عند الاستلام" : " on delivery") : "");

/** Approved per language in the store's WhatsApp account (E6-10). */
export const templateName = (lang: "ar" | "en") => `mizan_order_confirm_${lang}`;
export const TEMPLATES = [templateName("ar"), templateName("en")] as const;
/** Quick replies in template button order. */
export const TEMPLATE_ACTIONS = ["confirm", "change", "cancel"] as const;

/** Template body parameters, in order: greeting, store, order number, amount (+ "on delivery"). */
export const whatsappParams = (f: MessageFacts) => [hello(f), f.store, f.number, `${money(due(f), f.lang)}${payNote(f)}`];

export const CANCEL_REASONS = ["changed_mind", "ordered_by_mistake", "found_cheaper", "delivery_too_late", "other"] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

const REASON_TITLE: Record<"ar" | "en", Record<CancelReason | "keep", string>> = {
  ar: { changed_mind: "غيّرت رأيي", ordered_by_mistake: "طلبته بالغلط", found_cheaper: "لقيته أرخص", delivery_too_late: "التوصيل هيتأخر عليّا", other: "سبب تاني", keep: "لا، كمّل الأوردر" },
  en: { changed_mind: "Changed my mind", ordered_by_mistake: "Ordered by mistake", found_cheaper: "Found it cheaper", delivery_too_late: "Delivery is too late", other: "Another reason", keep: "No, keep my order" },
};

/** Follow-up messages inside the chat, after the customer taps (free-form, no template). */
export type ChatMessage = "confirmed" | "confirmed_offer" | "offer_added" | "offer_declined" | "offer_expired" | "offer_failed" | "change_prompt" | "change_received" | "cancel_reasons" | "cancelled" | "noted" | "already" | "opted_out" | "opted_in";
export const CHAT_MESSAGES: readonly ChatMessage[] = ["confirmed", "confirmed_offer", "offer_added", "offer_declined", "offer_expired", "offer_failed", "change_prompt", "change_received", "cancel_reasons", "cancelled", "noted", "already", "opted_out", "opted_in"];

export type ChatContent =
  | { type: "text"; text: string }
  | { type: "buttons"; body: string; buttons: Array<{ action: "offer_yes" | "offer_no"; arg: string; title: string }> }
  | { type: "list"; body: string; button: string; rows: Array<{ action: "reason" | "keep"; arg?: CancelReason; title: string }> };

/** Ends a sentence with one full stop ("1,250 ج.م." already has one). */
const stop = (s: string) => (s.endsWith(".") ? s : `${s}.`);

/** "طرحة مطابقة بـ 135 ج.م. بدل 150 ج.م." / "a matching scarf for EGP 135 instead of EGP 150". */
export function offerLine(o: OfferFacts, lang: "ar" | "en"): string {
  const qty = o.qty > 1 ? ` × ${o.qty}` : "";
  if (lang === "ar") return `${o.title}${qty} بـ ${money(o.price, lang)}${o.was ? ` بدل ${money(o.was, lang)}` : ""}`;
  return `${o.title}${qty} for ${money(o.price, lang)}${o.was ? ` instead of ${money(o.was, lang)}` : ""}`;
}

export function chatContent(m: ChatMessage, f: MessageFacts): ChatContent {
  const ar = f.lang === "ar";
  const own = (key: ScriptKey) => { const t = scriptText(f.script, f.lang, key); return t ? render(t, f) : null; };
  switch (m) {
    case "confirmed":
      return { type: "text", text: own("confirmed") ?? (ar ? `تمام ✅ أوردرك ${f.number} اتأكّد وهنشحنه قريب. شكراً إنك اخترت ${f.store}!` : `Done ✅ your order ${f.number} is confirmed and will ship soon. Thanks for choosing ${f.store}!`) };
    case "confirmed_offer": {
      const o = f.offer;
      if (!o) return chatContent("confirmed", f);
      const pitch = o.message ?? (ar ? `🎁 عرض ليك: ${stop(offerLine(o, "ar"))}` : `🎁 An offer for you: ${stop(offerLine(o, "en"))}`);
      const head = own("confirmed") ?? (ar ? `تمام ✅ أوردرك ${f.number} اتأكّد.` : `Done ✅ your order ${f.number} is confirmed.`);
      return {
        type: "buttons",
        body: ar ? `${head}\n\n${pitch}\nتحب نضيفه لنفس الأوردر؟` : `${head}\n\n${pitch}\nShall we add it to the same order?`,
        buttons: [{ action: "offer_yes", arg: o.id, title: ar ? "ضيفه" : "Add it" }, { action: "offer_no", arg: o.id, title: ar ? "لا شكراً" : "No, thanks" }],
      };
    }
    case "offer_added":
      return { type: "text", text: f.offer
        ? (ar ? `تمام ✅ هنضيف ${f.offer.title} لأوردرك، والإجمالي الجديد ${stop(money(f.offer.newTotal, "ar"))}` : `Done ✅ we'll add ${f.offer.title} to your order; the new total is ${stop(money(f.offer.newTotal, "en"))}`)
        : (ar ? "تمام ✅ هنضيفه لأوردرك." : "Done ✅ we'll add it to your order.") };
    case "offer_declined":
      return { type: "text", text: ar ? "ولا يهمك 🙏 أوردرك ماشي زي ما هو." : "No problem 🙏 your order stays as it is." };
    case "offer_failed":
      return { type: "text", text: f.offer
        ? (ar ? `معلش، مقدرناش نضيف ${f.offer.title} لأوردرك دلوقتي. فريق ${f.store} هيكلّمك يظبطها معاك.` : `Sorry, we couldn't add ${f.offer.title} to your order just now. The ${f.store} team will call you to sort it out.`)
        : (ar ? `معلش، مقدرناش نضيف العرض دلوقتي. فريق ${f.store} هيكلّمك.` : `Sorry, we couldn't add the offer just now. The ${f.store} team will call you.`) };
    case "offer_expired":
      return { type: "text", text: ar ? "العرض ده خلص، بس أوردرك ماشي زي ما هو 🙏" : "This offer has ended, but your order goes ahead as it is 🙏" };
    case "change_prompt":
      return { type: "text", text: own("change_prompt") ?? (ar ? "اكتب لنا التعديل اللي عايزه في رسالة (المقاس، اللون، العنوان أو المعاد)، وفريقنا هيكلّمك." : "Write the change you need in a message (size, colour, address or time) and our team will call you.") };
    case "change_received":
    case "noted":
      return { type: "text", text: own("change_received") ?? (ar ? `وصلنا ✍️ فريق ${f.store} هيكلّمك قريب.` : `Got it ✍️ the ${f.store} team will call you shortly.`) };
    case "cancel_reasons":
      return {
        type: "list", body: own("cancel_prompt") ?? (ar ? "خسارة 😔 ممكن تقولنا ليه عايز تلغي؟" : "Sorry to hear that 😔 why do you want to cancel?"), button: ar ? "اختار السبب" : "Choose a reason",
        rows: [...CANCEL_REASONS.map((r) => ({ action: "reason" as const, arg: r, title: REASON_TITLE[f.lang][r] })), { action: "keep" as const, title: REASON_TITLE[f.lang].keep }],
      };
    case "cancelled":
      return { type: "text", text: own("cancelled") ?? (ar ? `اتلغى أوردرك ${f.number}. لو غيّرت رأيك ابعتلنا في أي وقت.` : `Your order ${f.number} is cancelled. If you change your mind, message us anytime.`) };
    case "opted_out":
      return { type: "text", text: ar ? `تمام، مش هنبعتلك رسايل تاني هنا من ${f.store}. لو حبيت ترجع اكتب «ابدأ».` : `Done, ${f.store} won't message you here again. To start again, write START.` };
    case "opted_in":
      return { type: "text", text: ar ? `أهلاً بيك تاني 👋 هنبعتلك تحديثات أوردراتك من ${f.store} هنا.` : `Welcome back 👋 ${f.store} will send your order updates here.` };
    case "already":
      return { type: "text", text: ar ? `أوردرك ${f.number} متسجّل قبل كده. لو محتاج حاجة اكتبلنا هنا وفريقنا هيساعدك.` : `Your order ${f.number} is already recorded. If you need anything, write to us here and our team will help.` };
  }
}

/** The automated call (IVR): a greeting, the order, then the choices. */
export function callPrompts(f: MessageFacts): string[] {
  return f.lang === "ar"
    ? [`${hello(f)}، معاك ${f.store}.`, `بنأكّد أوردرك رقم ${f.number.replace(/^#/, "")} بـ ${money(due(f), f.lang)}.`, "لو عايز تأكّد اضغط واحد. لو عايز تعدّل اضغط اتنين. لو عايز تلغي اضغط تلاتة."]
    : [`${hello(f)}, this is ${f.store}.`, `We're confirming your order number ${f.number.replace(/^#/, "")} for ${money(due(f), f.lang)}.`, "To confirm, press 1. To change it, press 2. To cancel, press 3."];
}
export const CALL_DIGITS = { "1": "confirm", "2": "change", "3": "cancel" } as const;

/** What the store's team says on the phone (E6-10): the same facts, as lines to read. */
export function callScript(f: MessageFacts): string[] {
  const own = scriptText(f.script, f.lang, "call");
  if (own) {
    const offer = f.offer ? [f.lang === "ar" ? `🎁 وبعد ما يأكّد اعرض عليه: ${stop(offerLine(f.offer, "ar"))} تحب نضيفه لنفس الأوردر؟` : `🎁 Once confirmed, offer: ${stop(offerLine(f.offer, "en"))} Shall we add it to the same order?`] : [];
    return [...render(own, f).split("\n").map((l) => l.trim()).filter(Boolean), ...offer];
  }
  const items = (f.items ?? []).map((i) => (f.lang === "ar" ? `${i.title} × ${i.quantity}` : `${i.quantity} × ${i.title}`)).join(f.lang === "ar" ? "، " : ", ");
  const amount = `${money(due(f), f.lang)}${payNote(f)}`;
  return f.lang === "ar"
    ? [`${hello(f)}، معاك فريق ${f.store}.`, `بنأكّد أوردرك رقم ${f.number}${items ? `: ${items}` : ""}.`, `الإجمالي ${amount}.`, ...(f.city ? [`التوصيل لـ ${f.city}، صح؟`] : []), "نأكّد الأوردر ونشحنه لك؟",
      ...(f.offer ? [`🎁 وبعد ما يأكّد اعرض عليه: ${stop(offerLine(f.offer, "ar"))} تحب نضيفه لنفس الأوردر؟`] : [])]
    : [`${hello(f)}, this is the ${f.store} team.`, `We're confirming your order ${f.number}${items ? `: ${items}` : ""}.`, `The total is ${amount}.`, ...(f.city ? [`Delivery to ${f.city}, right?`] : []), "Shall we confirm and ship it?",
      ...(f.offer ? [`🎁 Once confirmed, offer: ${stop(offerLine(f.offer, "en"))} Shall we add it to the same order?`] : [])];
}

/** The message a team member sends by hand on WhatsApp (wa.me) with the confirm link, when no WhatsApp number is connected. */
export function linkText(f: MessageFacts): string {
  return f.lang === "ar"
    ? `${hello(f)}، أوردرك ${f.number} من ${f.store} بـ ${money(due(f), f.lang)}. أكّده أو عدّله من هنا: ${f.link}`
    : `${hello(f)}, your order ${f.number} from ${f.store} is ${money(due(f), f.lang)}. Confirm or change it here: ${f.link}`;
}

/** STOP / START typed alone in the chat (Meta's policy: honour an opt-out). Anything longer is a message to the team. */
const OPT_OUT = new Set(["stop", "unsubscribe", "ايقاف", "وقف", "وقف الرسايل", "وقف الرسائل", "الغاء الاشتراك", "متبعتليش تاني"]);
const OPT_IN = new Set(["start", "subscribe", "ابدا"]);
export function consentKeyword(text: string): "opt_out" | "opt_in" | null {
  const t = text.normalize("NFKC").replace(/[\u064B-\u0652\u0640]/g, "").replace(/[إأآ]/g, "ا").replace(/[.!؟?\s]+$/u, "").replace(/\s+/g, " ").trim().toLowerCase();
  if (OPT_OUT.has(t)) return "opt_out";
  if (OPT_IN.has(t)) return "opt_in";
  return null;
}
