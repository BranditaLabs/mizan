import { BUYER_CANCEL_REASONS, type Money } from "@mizan/shared";
import { PACK_REASONS, packReasonTitle, type ReasonItem, type Script } from "./script.js";
import { firstName, greeting, money, offerLine, packOf, payNote, say, templateParam } from "./script/render.js";

export { money, offerLine };

/**
 * What the customer receives (E6-7, E6-10), in the store's language. Only the store's name, the
 * first name, the order number, the items, the amount and the city: never the address or phone.
 * The WhatsApp templates must be approved by Meta with the wording in docs/modules/M02 §Templates;
 * every reply inside the chat is the store's script (E6-16a) and only the composition is here.
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
  /** The store's script (E6-5): its wording wins over the pack's. */
  script?: Script;
  /**
   * E6-23a: the thank-you after a tap carries the order summary (items, what the courier collects,
   * the area). `due`: from cashToCollect; zero is "paid"; null leaves the money line out. Never an address or phone.
   */
  summary?: { due: Money | null; more?: number } | null;
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

const due = (f: MessageFacts) => (Number(f.cod.amount) > 0 ? f.cod : f.total);
/** The IVR keeps the Egyptian greeting: its prompts are fixed until a voice vendor exists (E6-8). */
const hello = (f: Pick<MessageFacts, "lang" | "firstName">) => (f.lang === "ar" ? (f.firstName ? `أهلاً ${f.firstName}` : "أهلاً بيك") : f.firstName ? `Hi ${f.firstName}` : "Hi");

/** Approved per language in the store's WhatsApp account (E6-10). */
export const templateName = (lang: "ar" | "en") => `mizan_order_confirm_${lang}`;
export const TEMPLATES = [templateName("ar"), templateName("en")] as const;
/** Quick replies in template button order. */
export const TEMPLATE_ACTIONS = ["confirm", "change", "cancel"] as const;
/** The approved templates as Meta shows them (M02 §Templates): read-only in the editor and the preview. */
export const TEMPLATE_TEXT: Record<"ar" | "en", { body: string; buttons: readonly [string, string, string] }> = {
  ar: { body: "{{1}} 👋\nأوردرك رقم {{3}} من {{2}} وصلنا.\nالإجمالي {{4}}.\nأكّد الأوردر عشان نجهّزه ونشحنه لك.", buttons: ["أكّد الأوردر", "عايز أعدّل", "ألغي الأوردر"] },
  en: { body: "{{1}} 👋\nWe received your order {{3}} from {{2}}.\nTotal: {{4}}.\nPlease confirm so we can prepare and ship it.", buttons: ["Confirm order", "I want a change", "Cancel order"] },
};

/** Template body parameters, in order: greeting, store, order number, amount (+ "on delivery"). Only the pack's greeting and the checked on_delivery flow in. */
export const whatsappParams = (f: MessageFacts) => [greeting(f), f.store, f.number, `${money(due(f), f.lang)}${payNote(f)}`].map(templateParam);

/** The canonical codes a store's reasons map onto (shared with the dashboard). */
export const CANCEL_REASONS = BUYER_CANCEL_REASONS;
export type CancelReason = (typeof CANCEL_REASONS)[number];

/** Follow-up messages inside the chat, after the customer taps (free-form, no template). */
export type ChatMessage = "confirmed" | "confirmed_offer" | "offer_added" | "offer_declined" | "offer_expired" | "offer_failed" | "change_prompt" | "change_received" | "cancel_reasons" | "cancelled" | "noted" | "already" | "opted_out" | "opted_in";
export const CHAT_MESSAGES: readonly ChatMessage[] = ["confirmed", "confirmed_offer", "offer_added", "offer_declined", "offer_expired", "offer_failed", "change_prompt", "change_received", "cancel_reasons", "cancelled", "noted", "already", "opted_out", "opted_in"];

/** A text header (media headers later, E6-17). */
export interface ChatHeader { type: "text"; text: string }
export type ChatContent =
  | { type: "text"; text: string }
  | { type: "buttons"; body: string; buttons: Array<{ action: "offer_yes" | "offer_no"; arg: string; title: string }>; header?: ChatHeader; footer?: string }
  | { type: "list"; body: string; button: string; rows: Array<{ action: "reason" | "keep"; arg?: string; title: string; description?: string }>; header?: ChatHeader; footer?: string; section?: string };

/** Ends a sentence with one full stop ("1,250 ج.م." already has one). */
const stop = (s: string) => (s.endsWith(".") ? s : `${s}.`);

/**
 * The signed argument of a reason row: the canonical code's index and the store's id
 * ("4-wrong_size"), so a reason renamed or deleted after the send still cancels with its code.
 * A pack reason (id = its code) is sent as the bare code, as before E6-16a.
 */
export const reasonArg = (r: ReasonItem) => (r.id === r.code ? r.code : `${BUYER_CANCEL_REASONS.indexOf(r.code)}-${r.id}`);

/** The code and the store's id behind a tapped reason; anything unknown is "other". */
export function reasonOf(arg: string | undefined): { code: CancelReason; id: string | null } {
  const m = /^(\d)-([a-z0-9_]{1,32})$/.exec(arg ?? "");
  if (m) { const code = BUYER_CANCEL_REASONS[Number(m[1])]; return code ? { code, id: m[2]! } : { code: "other", id: null }; }
  if ((BUYER_CANCEL_REASONS as readonly string[]).includes(arg ?? "")) return { code: arg as CancelReason, id: arg! };
  return { code: "other", id: null };
}

/**
 * The order summary after confirming (E6-23a): the items, what the courier collects, the area. Fits
 * `budget` characters (an interactive message's body is 1024 at most): item titles are shortened,
 * then items dropped with "+N more", then the summary left out rather than the message refused.
 */
export function summaryBlock(f: MessageFacts, budget = 3000): string {
  if (!f.summary) return "";
  const due = f.summary.due;
  const tail: string[] = [];
  if (due) tail.push(Number(due.amount) > 0 ? say(f, "summary_pay", { extra: { "summary.due": money(due, f.lang) } })! : say(f, "summary_paid")!);
  if (f.city) tail.push(say(f, "summary_area")!);
  const items = f.items ?? [];
  const extra = f.summary.more ?? 0;
  const build = (n: number, width: number) => {
    const cut = (t: string) => (t.length > width ? `${t.slice(0, width - 1)}…` : t);
    const lines = items.slice(0, n).map((i) => `• ${i.quantity}× ${cut(i.title)}`);
    const left = items.length - n + extra;
    if (left > 0) lines.push(`• ${say(f, "summary_more", { extra: { "summary.more": String(left) } })}`);
    return `\n\n${[...lines, ...tail].join("\n")}`;
  };
  for (const width of [80, 40, 24]) {
    for (let n = items.length; n >= 1; n--) { const b = build(n, width); if (b.length <= budget) return b; }
  }
  const bare = `\n\n${tail.join("\n")}`;
  return tail.length && bare.length <= budget ? bare : "";
}

const header = (text: string | null) => (text ? { header: { type: "text" as const, text } } : {});
const part = <K extends string>(k: K, v: string | null) => (v ? { [k]: v } as Record<K, string> : {});

export function chatContent(m: ChatMessage, f: MessageFacts): ChatContent {
  const t = (key: Parameters<typeof say>[1]) => say(f, key)!;
  const footer = part("footer", say(f, "footer"));
  switch (m) {
    case "confirmed":
      return { type: "text", text: t("confirmed") + summaryBlock(f) };
    case "confirmed_offer": {
      const o = f.offer;
      if (!o) return chatContent("confirmed", f);
      const pitch = o.message ?? t("offer_pitch");
      const ask = `\n\n${pitch}\n${t("offer_question")}`;
      // The owner's own "confirmed" still opens it when they wrote no top of their own (as before
      // E6-16a), at any length that fits beside the offer; else the pack's top, never its "confirmed".
      const top = say(f, "confirmed_offer_top", { ownerOnly: true })
        ?? say(f, "confirmed", { ownerOnly: true, ownOrNull: true, limit: 1024 - ask.length })
        ?? t("confirmed_offer_top");
      // WhatsApp refuses an interactive body over 1024 characters: the summary gets what is left.
      const head = top + summaryBlock(f, 1024 - top.length - ask.length);
      return {
        type: "buttons",
        body: `${head}${ask}`,
        buttons: [{ action: "offer_yes", arg: o.id, title: t("btn_offer_yes") }, { action: "offer_no", arg: o.id, title: t("btn_offer_no") }],
        ...footer,
      };
    }
    case "offer_added":
      return { type: "text", text: t(f.offer ? "offer_added" : "offer_added_generic") };
    case "offer_declined":
      return { type: "text", text: t("offer_declined") };
    case "offer_failed":
      return { type: "text", text: t(f.offer ? "offer_failed" : "offer_failed_generic") };
    case "offer_expired":
      return { type: "text", text: t("offer_expired") };
    case "change_prompt":
      return { type: "text", text: t("change_prompt") };
    case "change_received":
      return { type: "text", text: t("change_received") };
    case "noted":
      // Until the owner writes "noted", a typed message gets their own "change received" (as before E6-16a).
      return { type: "text", text: say(f, "noted", { ownerOnly: true }) ?? say(f, "change_received", { ownerOnly: true }) ?? t("noted") };
    case "cancel_reasons": {
      const pack = packOf(f.script);
      const reasons = f.script?.cancelReasons ?? PACK_REASONS[pack];
      const keepDescription = say(f, "keep_description");
      return {
        type: "list", body: t("cancel_prompt"), button: t("cancel_button"),
        rows: [
          ...reasons.map((r) => {
            const description = r.description?.[f.lang]?.trim();
            return { action: "reason" as const, arg: reasonArg(r), title: r.title[f.lang] ?? packReasonTitle(pack, f.lang, r.code), ...(description ? { description } : {}) };
          }),
          { action: "keep" as const, title: t("keep_title"), ...part("description", keepDescription) },
        ],
        ...header(say(f, "cancel_header")), ...part("section", say(f, "cancel_section")), ...footer,
      };
    }
    case "cancelled":
      return { type: "text", text: t("cancelled") };
    case "opted_out":
      return { type: "text", text: t("opted_out") };
    case "opted_in":
      return { type: "text", text: t("opted_in") };
    case "already":
      return { type: "text", text: t("already") };
  }
}

/** The automated call (IVR): a greeting, the order, then the choices. Fixed until a voice vendor exists (E6-8). */
export function callPrompts(f: MessageFacts): string[] {
  return f.lang === "ar"
    ? [`${hello(f)}، معاك ${f.store}.`, `بنأكّد أوردرك رقم ${f.number.replace(/^#/, "")} بـ ${money(due(f), f.lang)}.`, "لو عايز تأكّد اضغط واحد. لو عايز تعدّل اضغط اتنين. لو عايز تلغي اضغط تلاتة."]
    : [`${hello(f)}, this is ${f.store}.`, `We're confirming your order number ${f.number.replace(/^#/, "")} for ${money(due(f), f.lang)}.`, "To confirm, press 1. To change it, press 2. To cancel, press 3."];
}
export const CALL_DIGITS = { "1": "confirm", "2": "change", "3": "cancel" } as const;

/** The call script's fixed words per pack; the items and the city stay optional lines. */
const CALL_AR = {
  egyptian: { team: "معاك فريق", confirming: "بنأكّد أوردرك رقم", city: "التوصيل لـ", right: "صح؟", ask: "نأكّد الأوردر ونشحنه لك؟" },
  formal: { hi: "مرحباً", team: "معك فريق", confirming: "نتصل لتأكيد طلبك رقم", city: "التوصيل إلى", right: "أليس كذلك؟", ask: "هل نؤكد الطلب ونشحنه لك؟" },
  gulf: { team: "معك فريق", confirming: "نتصل عشان نأكد طلبك رقم", city: "التوصيل لـ", right: "صح؟", ask: "نأكد الطلب ونشحنه لك؟" },
} as const;

/** What the store's team says on the phone (E6-10): the same facts, as lines to read. */
export function callScript(f: MessageFacts): string[] {
  const own = say(f, "call");
  const offer = f.offer ? [f.lang === "ar" ? `🎁 وبعد ما يأكّد اعرض عليه: ${stop(offerLine(f.offer, "ar"))} تحب نضيفه لنفس الأوردر؟` : `🎁 Once confirmed, offer: ${stop(offerLine(f.offer, "en"))} Shall we add it to the same order?`] : [];
  if (own) return [...own.split("\n").map((l) => l.trim()).filter(Boolean), ...offer];
  const items = (f.items ?? []).map((i) => (f.lang === "ar" ? `${i.title} × ${i.quantity}` : `${i.quantity} × ${i.title}`)).join(f.lang === "ar" ? "، " : ", ");
  const amount = `${money(due(f), f.lang)}${payNote(f)}`;
  if (f.lang === "ar") {
    const w = CALL_AR[packOf(f.script)];
    const name = firstName(f);
    return [`${"hi" in w && name ? `${w.hi} ${name}` : greeting(f)}، ${w.team} ${f.store}.`, `${w.confirming} ${f.number}${items ? `: ${items}` : ""}.`, stop(`الإجمالي ${amount}`), ...(f.city ? [`${w.city} ${f.city}، ${w.right}`] : []), w.ask, ...offer];
  }
  return [`${greeting(f)}, this is the ${f.store} team.`, `We're confirming your order ${f.number}${items ? `: ${items}` : ""}.`, `The total is ${amount}.`, ...(f.city ? [`Delivery to ${f.city}, right?`] : []), "Shall we confirm and ship it?", ...offer];
}

/** The message a team member sends by hand on WhatsApp (wa.me) with the confirm link, when no WhatsApp number is connected. */
export function linkText(f: MessageFacts): string {
  return say(f, "link_text")!;
}

/** STOP / START typed alone in the chat (Meta's policy: honour an opt-out). Anything longer is a message to the team. */
const OPT_OUT = new Set(["stop", "unsubscribe", "ايقاف", "وقف", "وقف الرسايل", "وقف الرسائل", "الغاء الاشتراك", "متبعتليش تاني"]);
const OPT_IN = new Set(["start", "subscribe", "ابدا"]);
export function consentKeyword(text: string): "opt_out" | "opt_in" | null {
  const t = text.normalize("NFKC").replace(/[ً-ْـ]/g, "").replace(/[إأآ]/g, "ا").replace(/[.!؟?\s]+$/u, "").replace(/\s+/g, " ").trim().toLowerCase();
  if (OPT_OUT.has(t)) return "opt_out";
  if (OPT_IN.has(t)) return "opt_in";
  return null;
}
