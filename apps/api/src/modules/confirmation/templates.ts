/**
 * The confirmation's first message (M2, E6-10, E6-16d): the WhatsApp templates Meta approves in
 * each store's own account. One catalogue, used to send, to check the account, to submit to Meta,
 * in the preview and in the editor's catalogue. The owner picks the Arabic wording (Egyptian,
 * formal or Gulf); English is one. The four parameters are the same for all (`whatsappParams`):
 * greeting, store, order number, amount. Meta refuses a body that starts or ends with a variable,
 * hence the leading 👋.
 */
export const TEMPLATE_VARIANTS = ["ar_egyptian", "ar_formal", "ar_gulf", "en"] as const;
export type TemplateVariant = (typeof TEMPLATE_VARIANTS)[number];
/** The Arabic choices, in the order a fallback tries them. */
export const AR_VARIANTS = ["ar_egyptian", "ar_formal", "ar_gulf"] as const;
export type ArabicVariant = (typeof AR_VARIANTS)[number];

/** Quick replies in template button order: the tap's signed payload is set per button index. */
export const TEMPLATE_ACTIONS = ["confirm", "change", "cancel"] as const;
export type TemplateAction = (typeof TEMPLATE_ACTIONS)[number];

export interface TemplateSpec {
  variant: TemplateVariant;
  /** The name in the store's WhatsApp account. */
  name: string;
  /** Meta's language code. */
  lang: "ar" | "en";
  category: "UTILITY";
  body: string;
  /** In TEMPLATE_ACTIONS order, each at most 20 characters. */
  buttons: readonly [string, string, string];
  /** A sample of the four parameters, for Meta's review (`example`). */
  example: readonly [string, string, string, string];
}

const AR_EXAMPLE = ["أهلاً منى", "متجر النيل", "#1001", "1,250 ج.م. عند الاستلام"] as const;

export const TEMPLATE_SPECS: Record<TemplateVariant, TemplateSpec> = {
  ar_egyptian: {
    variant: "ar_egyptian", name: "mizan_order_confirm_ar", lang: "ar", category: "UTILITY",
    body: "👋 {{1}}\nأوردرك رقم {{3}} من {{2}} وصلنا.\nالإجمالي {{4}}.\nأكّد الأوردر عشان نجهّزه ونشحنه لك.",
    buttons: ["أكّد الأوردر", "عايز أعدّل", "ألغي الأوردر"], example: AR_EXAMPLE,
  },
  ar_formal: {
    variant: "ar_formal", name: "mizan_order_confirm_ar_formal", lang: "ar", category: "UTILITY",
    body: "👋 {{1}}\nاستلمنا طلبك رقم {{3}} من {{2}}.\nالإجمالي {{4}}.\nيُرجى تأكيد الطلب لنجهّزه ونشحنه إليك.",
    buttons: ["تأكيد الطلب", "أريد تعديلاً", "إلغاء الطلب"], example: ["أهلاً منى", "متجر النيل", "#1001", "1,250 ج.م. عند الاستلام"],
  },
  ar_gulf: {
    variant: "ar_gulf", name: "mizan_order_confirm_ar_gulf", lang: "ar", category: "UTILITY",
    body: "👋 {{1}}\nوصلنا طلبك رقم {{3}} من {{2}}.\nالإجمالي {{4}}.\nأكّد طلبك عشان نجهّزه ونشحنه لك.",
    buttons: ["أكّد الطلب", "أبي أعدّل", "ألغِ الطلب"], example: ["هلا منى", "متجر النخيل", "#1001", "450 ر.س عند الاستلام"],
  },
  en: {
    variant: "en", name: "mizan_order_confirm_en", lang: "en", category: "UTILITY",
    body: "👋 {{1}}\nWe received your order {{3}} from {{2}}.\nTotal: {{4}}.\nPlease confirm so we can prepare and ship it.",
    buttons: ["Confirm order", "I want a change", "Cancel order"], example: ["Hi Mona", "Nile Store", "#1001", "EGP 1,250 on delivery"],
  },
};

export const TEMPLATE_NAMES: readonly string[] = TEMPLATE_VARIANTS.map((v) => TEMPLATE_SPECS[v].name);
export const variantOfName = (name: string): TemplateVariant | null => TEMPLATE_VARIANTS.find((v) => TEMPLATE_SPECS[v].name === name) ?? null;

/** The Arabic first message a pack starts with when the owner chose none. */
const BY_PACK: Record<"egyptian" | "formal" | "gulf", ArabicVariant> = { egyptian: "ar_egyptian", formal: "ar_formal", gulf: "ar_gulf" };

/** What the owner chose for the store's language: Arabic per `script.template`, else the pack's; English is always `en`. */
export function chosenTemplate(lang: "ar" | "en", script: { pack?: "egyptian" | "formal" | "gulf"; template?: ArabicVariant } | undefined): TemplateVariant {
  if (lang === "en") return "en";
  return script?.template ?? BY_PACK[script?.pack ?? "egyptian"];
}

/** Meta's review states, plus MISSING (not in the account) and UNKNOWN (no number connected, or never checked). */
export const TEMPLATE_STATUSES = ["APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED", "MISSING", "UNKNOWN"] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

/** A status as stored from Meta (`config.templates[name]`); IN_APPEAL reads as PENDING, anything else Meta invents as REJECTED. */
export function statusOf(statuses: Record<string, string> | null | undefined, variant: TemplateVariant): TemplateStatus {
  if (!statuses) return "UNKNOWN";
  const s = statuses[TEMPLATE_SPECS[variant].name];
  if (!s) return "MISSING";
  if (s === "IN_APPEAL") return "PENDING";
  if ((TEMPLATE_STATUSES as readonly string[]).includes(s)) return s as TemplateStatus;
  return s === "LIMIT_EXCEEDED" ? "PAUSED" : "REJECTED";
}

/**
 * The template a send uses: the chosen one when Meta approved it; for Arabic, else the first
 * approved of Egyptian, formal, Gulf (`fallback` set: the owner hears of it); else the chosen one
 * (the send fails and is classified as before: template missing).
 */
export function effectiveTemplate(choice: TemplateVariant, lang: "ar" | "en", statuses: Record<string, string> | null | undefined): { variant: TemplateVariant; fallback: boolean } {
  if (lang === "en") return { variant: "en", fallback: false };
  const chosen: TemplateVariant = choice === "en" ? "ar_egyptian" : choice;
  if (statusOf(statuses, chosen) === "APPROVED") return { variant: chosen, fallback: false };
  const other = AR_VARIANTS.find((v) => statusOf(statuses, v) === "APPROVED");
  return other ? { variant: other, fallback: true } : { variant: chosen, fallback: false };
}

/** A template the owner can (re)submit: Meta has none under that name, or refused it. */
export const submittable = (status: TemplateStatus) => status === "MISSING" || status === "REJECTED";

/** The action behind a quick reply's title when Meta sends no payload: any variant's buttons, in order. */
export function templateActionOf(title: string | undefined): TemplateAction | null {
  const t = title?.normalize("NFKC").trim();
  if (!t) return null;
  for (const v of TEMPLATE_VARIANTS) {
    const i = TEMPLATE_SPECS[v].buttons.findIndex((b) => b.normalize("NFKC") === t);
    if (i >= 0) return TEMPLATE_ACTIONS[i]!;
  }
  return null;
}
