import type { Money } from "@mizan/shared";

/**
 * What the customer receives (E6-7), in Egyptian Arabic or English (the store's language).
 * Only the store's name, the order number, the amount and the link: no address, no items with
 * personal notes. WhatsApp templates must be approved by Meta with the same wording (E6-4).
 */
export interface MessageFacts {
  lang: "ar" | "en";
  store: string;
  firstName: string | null;
  number: string;
  /** What the customer pays the courier (0 when prepaid). */
  cod: Money;
  total: Money;
  link: string;
}

/** "1,250 ج.م." / "EGP 1,250": plain text for SMS and voice (no direction marks, Western digits). */
export function money(m: Money, lang: "ar" | "en"): string {
  const [int = "0", frac = ""] = m.amount.replace(/^-/, "").split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const n = /^0*$/.test(frac) ? grouped : `${grouped}.${frac}`;
  if (lang === "en") return `${m.currency} ${n}`;
  return m.currency === "EGP" ? `${n} ج.م.` : `${n} ${m.currency}`;
}

const hello = (f: MessageFacts) => (f.lang === "ar" ? (f.firstName ? `أهلاً ${f.firstName}` : "أهلاً بيك") : f.firstName ? `Hi ${f.firstName}` : "Hi");
const due = (f: MessageFacts) => (Number(f.cod.amount) > 0 ? f.cod : f.total);

export const WHATSAPP_TEMPLATE = "order_confirmation";
export const BUTTONS = ["confirm", "change", "cancel"] as const;

/** Template body parameters, in order: greeting, store, order number, amount. */
export const whatsappParams = (f: MessageFacts) => [hello(f), f.store, f.number, money(due(f), f.lang)];

export function smsText(f: MessageFacts): string {
  return f.lang === "ar"
    ? `${hello(f)}، أوردرك ${f.number} من ${f.store} بـ ${money(due(f), f.lang)}. أكّده أو عدّله من هنا: ${f.link}`
    : `${hello(f)}, your order ${f.number} from ${f.store} is ${money(due(f), f.lang)}. Confirm or change it here: ${f.link}`;
}

/** The automated call (IVR): a greeting, the order, then the choices. */
export function callPrompts(f: MessageFacts): string[] {
  return f.lang === "ar"
    ? [`${hello(f)}، معاك ${f.store}.`, `بنأكّد أوردرك رقم ${f.number.replace(/^#/, "")} بـ ${money(due(f), f.lang)}.`, "لو عايز تأكّد اضغط واحد. لو عايز تعدّل اضغط اتنين. لو عايز تلغي اضغط تلاتة."]
    : [`${hello(f)}, this is ${f.store}.`, `We're confirming your order number ${f.number.replace(/^#/, "")} for ${money(due(f), f.lang)}.`, "To confirm, press 1. To change it, press 2. To cancel, press 3."];
}
export const CALL_DIGITS = { "1": "confirm", "2": "change", "3": "cancel" } as const;

/** The message an agent sends by hand on WhatsApp (wa.me) when no provider is connected. */
export const manualText = smsText;
