import type { Money } from "@mizan/shared";

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
export type ChatMessage = "confirmed" | "change_prompt" | "change_received" | "cancel_reasons" | "cancelled" | "noted" | "already";
export const CHAT_MESSAGES: readonly ChatMessage[] = ["confirmed", "change_prompt", "change_received", "cancel_reasons", "cancelled", "noted", "already"];

export type ChatContent =
  | { type: "text"; text: string }
  | { type: "list"; body: string; button: string; rows: Array<{ action: "reason" | "keep"; arg?: CancelReason; title: string }> };

export function chatContent(m: ChatMessage, f: MessageFacts): ChatContent {
  const ar = f.lang === "ar";
  switch (m) {
    case "confirmed":
      return { type: "text", text: ar ? `تمام ✅ أوردرك ${f.number} اتأكّد وهنشحنه قريب. شكراً إنك اخترت ${f.store}!` : `Done ✅ your order ${f.number} is confirmed and will ship soon. Thanks for choosing ${f.store}!` };
    case "change_prompt":
      return { type: "text", text: ar ? "اكتب لنا التعديل اللي عايزه في رسالة (المقاس، اللون، العنوان أو المعاد)، وفريقنا هيكلّمك." : "Write the change you need in a message (size, colour, address or time) and our team will call you." };
    case "change_received":
    case "noted":
      return { type: "text", text: ar ? `وصلنا ✍️ فريق ${f.store} هيكلّمك قريب.` : `Got it ✍️ the ${f.store} team will call you shortly.` };
    case "cancel_reasons":
      return {
        type: "list", body: ar ? "خسارة 😔 ممكن تقولنا ليه عايز تلغي؟" : "Sorry to hear that 😔 why do you want to cancel?", button: ar ? "اختار السبب" : "Choose a reason",
        rows: [...CANCEL_REASONS.map((r) => ({ action: "reason" as const, arg: r, title: REASON_TITLE[f.lang][r] })), { action: "keep" as const, title: REASON_TITLE[f.lang].keep }],
      };
    case "cancelled":
      return { type: "text", text: ar ? `اتلغى أوردرك ${f.number}. لو غيّرت رأيك ابعتلنا في أي وقت.` : `Your order ${f.number} is cancelled. If you change your mind, message us anytime.` };
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
  const items = (f.items ?? []).map((i) => (f.lang === "ar" ? `${i.title} × ${i.quantity}` : `${i.quantity} × ${i.title}`)).join(f.lang === "ar" ? "، " : ", ");
  const amount = `${money(due(f), f.lang)}${payNote(f)}`;
  return f.lang === "ar"
    ? [`${hello(f)}، معاك فريق ${f.store}.`, `بنأكّد أوردرك رقم ${f.number}${items ? `: ${items}` : ""}.`, `الإجمالي ${amount}.`, ...(f.city ? [`التوصيل لـ ${f.city}، صح؟`] : []), "نأكّد الأوردر ونشحنه لك؟"]
    : [`${hello(f)}, this is the ${f.store} team.`, `We're confirming your order ${f.number}${items ? `: ${items}` : ""}.`, `The total is ${amount}.`, ...(f.city ? [`Delivery to ${f.city}, right?`] : []), "Shall we confirm and ship it?"];
}

/** The message a team member sends by hand on WhatsApp (wa.me) with the confirm link, when no WhatsApp number is connected. */
export function linkText(f: MessageFacts): string {
  return f.lang === "ar"
    ? `${hello(f)}، أوردرك ${f.number} من ${f.store} بـ ${money(due(f), f.lang)}. أكّده أو عدّله من هنا: ${f.link}`
    : `${hello(f)}, your order ${f.number} from ${f.store} is ${money(due(f), f.lang)}. Confirm or change it here: ${f.link}`;
}
