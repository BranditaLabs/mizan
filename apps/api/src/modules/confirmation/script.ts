import { z } from "zod";
import { money, type MessageFacts } from "./messages.js";

/**
 * The store's confirmation script (M2, E6-5): its own wording for what the customer reads after a
 * tap — one message per button (Confirm, Change, Cancel), the change and cancel follow-ups — and
 * for what the team says on the phone, with variables filled from the order. The WhatsApp template
 * itself stays the Meta-approved one. A language pack gives the starting wording (Egyptian Arabic,
 * or formal Arabic for stores that prefer it); a text the owner writes wins over the pack.
 */
export const SCRIPT_KEYS = ["confirmed", "change_prompt", "change_received", "cancel_prompt", "cancelled", "call"] as const;
export type ScriptKey = (typeof SCRIPT_KEYS)[number];
/** The button reply each message answers (the script's branches). */
export const SCRIPT_BRANCH: Record<ScriptKey, "confirm" | "change" | "cancel" | "call"> = {
  confirmed: "confirm", change_prompt: "change", change_received: "change", cancel_prompt: "cancel", cancelled: "cancel", call: "call",
};
export const PACKS = ["egyptian", "formal"] as const;
export type Pack = (typeof PACKS)[number];

/** Variables: never the address or phone — only what the messages already show. */
export const VARIABLES = ["customer.first_name", "order.number", "order.total", "order.cod", "order.items", "order.city", "store.name"] as const;
const VARIABLE = /\{\{\s*([a-z_.]+)\s*\}\}/g;
/** WhatsApp list and button bodies hold 1,024 characters; a call script is read, not sent. */
const MAX: Record<ScriptKey, number> = { confirmed: 1000, change_prompt: 1000, change_received: 1000, cancel_prompt: 1000, cancelled: 1000, call: 2000 };

export function unknownVariables(text: string): string[] {
  return [...new Set([...text.matchAll(VARIABLE)].map((m) => m[1]!).filter((v) => !(VARIABLES as readonly string[]).includes(v)))];
}

const Texts = z.object(Object.fromEntries(SCRIPT_KEYS.map((k) => [k, z.string().trim().min(1).max(MAX[k]).optional()])) as Record<ScriptKey, z.ZodOptional<z.ZodString>>)
  .superRefine((t, ctx) => {
    for (const [k, v] of Object.entries(t)) {
      const bad = v ? unknownVariables(v) : [];
      if (bad.length) ctx.addIssue({ code: "custom", path: [k], message: `unknown variable: ${bad.map((b) => `{{${b}}}`).join(", ")}` });
    }
  });
export const ScriptSchema = z.object({
  pack: z.enum(PACKS).describe("The starting wording: egyptian (default) or formal Arabic"),
  texts: z.object({ ar: Texts, en: Texts }).describe("The owner's own wording per message and language; empty = the pack's"),
});
export type Script = z.output<typeof ScriptSchema>;
export const DEFAULT_SCRIPT: Script = { pack: "egyptian", texts: { ar: {}, en: {} } };

/** Formal Arabic for stores that prefer it (the Egyptian pack is the messages' own wording). */
const FORMAL_AR: Record<ScriptKey, string> = {
  confirmed: "تم ✅ تأكيد طلبك {{order.number}} وسيتم شحنه قريباً. شكراً لاختيارك {{store.name}}.",
  change_prompt: "يرجى كتابة التعديل المطلوب في رسالة (المقاس أو اللون أو العنوان أو الموعد)، وسيتواصل معك فريقنا.",
  change_received: "تم الاستلام ✍️ سيتواصل معك فريق {{store.name}} قريباً.",
  cancel_prompt: "نأسف لذلك 😔 هل يمكنك إخبارنا بسبب الإلغاء؟",
  cancelled: "تم إلغاء طلبك {{order.number}}. يسعدنا تواصلك معنا في أي وقت.",
  call: "مرحباً {{customer.first_name}}، معك فريق {{store.name}}.\nنتصل لتأكيد طلبك رقم {{order.number}}: {{order.items}}.\nالإجمالي {{order.cod}}.\nهل نؤكد الطلب ونشحنه لك؟",
};

/** The wording to use for one message, or null for the built-in Egyptian / English one. */
export function scriptText(script: Script | undefined, lang: "ar" | "en", key: ScriptKey): string | null {
  const own = script?.texts[lang]?.[key];
  if (own) return own;
  return script?.pack === "formal" && lang === "ar" ? FORMAL_AR[key] : null;
}

/** Fill the variables from the order (what the customer pays: the cash on delivery, else the total). */
export function render(text: string, f: MessageFacts): string {
  const due = Number(f.cod.amount) > 0 ? `${money(f.cod, f.lang)}${f.lang === "ar" ? " عند الاستلام" : " on delivery"}` : money(f.total, f.lang);
  const items = (f.items ?? []).map((i) => (f.lang === "ar" ? `${i.title} × ${i.quantity}` : `${i.quantity} × ${i.title}`)).join(f.lang === "ar" ? "، " : ", ");
  const values: Record<(typeof VARIABLES)[number], string> = {
    "customer.first_name": f.firstName ?? (f.lang === "ar" ? "حضرتك" : "there"),
    "order.number": f.number, "order.total": money(f.total, f.lang), "order.cod": due, "order.items": items, "order.city": f.city ?? "", "store.name": f.store,
  };
  return text.replace(VARIABLE, (whole, name: string) => (name in values ? values[name as keyof typeof values] : whole)).replace(/[ \t]+\n/g, "\n").trim();
}
