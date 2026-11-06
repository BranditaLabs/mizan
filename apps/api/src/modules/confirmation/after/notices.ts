/**
 * The team's notices from what happens after confirmation: the order number and a reason, never
 * a name, phone, address or what the customer typed. In the store's language.
 */
type Lang = "ar" | "en";

const TEXT: Record<string, { ar: string; en: string }> = {
  confirmed: { ar: "الأوردر {n} اتأكّد", en: "Order {n} was confirmed" },
  changed: { ar: "العميل طلب تعديل في الأوردر {n}", en: "The customer asked to change order {n}" },
  cancelled: { ar: "الأوردر {n} اتلغى", en: "Order {n} was cancelled" },
  no_answer: { ar: "محدش ردّ على تأكيد الأوردر {n}", en: "Nobody answered the confirmation of order {n}" },
  opted_out: { ar: "عميل الأوردر {n} طلب ما يوصلوش رسايل، كلّموه", en: "The customer of order {n} asked for no messages: call them" },
  customer_message: { ar: "العميل كتب رسالة بعد تأكيد الأوردر {n}، اتوقّف لحد ما تشوفوه", en: "The customer wrote after confirming order {n}: held until you look at it" },
  auto_cancelled: { ar: "الأوردر {n} اتلغى لوحده عشان محدش ردّ", en: "Order {n} was cancelled automatically: nobody answered" },
  followup_dead: { ar: "خطوة بعد التأكيد للأوردر {n} وقفت، محتاجة حد يشوفها", en: "A step after confirming order {n} stopped and needs a person" },
};

/** Why automatic booking stopped, in words. */
const BLOCKED: Record<string, { ar: string; en: string }> = {
  payment_blocks_shipping: { ar: "الدفع لسه ما وصلش", en: "the payment hasn't arrived" },
  payment_mode_not_allowed: { ar: "طريقة الدفع مش من اللي بتتحجز لوحدها", en: "its payment method isn't one that books by itself" },
  address_missing: { ar: "العنوان أو الموبايل ناقص", en: "the address or phone is missing" },
  no_courier: { ar: "مفيش شركة شحن متوصّلة", en: "no courier is connected" },
  courier_needs_attention: { ar: "حساب شركة الشحن محتاج مراجعة", en: "the courier account needs attention" },
  store_not_connected: { ar: "المتجر مش متوصّل", en: "the store isn't connected" },
  stock_short: { ar: "المخزون مش مكفّي", en: "there isn't enough stock" },
  duplicate_suspected: { ar: "ممكن يكون أوردر مكرّر", en: "it may be a duplicate" },
  offer_settling: { ar: "عرض أو تعديل لسه بيتسجّل", en: "an offer or edit is still being applied" },
  order_moved: { ar: "حالة الأوردر اتغيّرت", en: "the order changed meanwhile" },
};

export function notice(kind: keyof typeof TEXT, number: string, lang: Lang): string {
  return (TEXT[kind] ?? TEXT.confirmed!)[lang].replace("{n}", number);
}

export function blockedNotice(code: string, number: string, lang: Lang): string {
  const why = (BLOCKED[code] ?? { ar: code, en: code })[lang];
  return lang === "ar" ? `الحجز التلقائي للأوردر ${number} اتوقّف: ${why}` : `Automatic booking of order ${number} stopped: ${why}`;
}
