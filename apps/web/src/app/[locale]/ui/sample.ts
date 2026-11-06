import type { PaymentMethod } from "@/components/ui/Badge";
import type { PhoneTurn } from "@/components/studio/WhatsAppPhone";

/**
 * Sample data for the UI gallery (fictional people and orders, never real customers). Names and
 * places are given in both languages; ids, phones and amounts are the same in both.
 */
export type Text = { ar: string; en: string };
export type OrderStatus = "new" | "pending" | "confirmed" | "shipped" | "delivered" | "refused";

export interface SampleOrder {
  id: string; customer: Text; area: Text; phone: string; payment: PaymentMethod; total: string; risk: number; status: OrderStatus; minutesAgo: number;
}

export const ORDERS: readonly SampleOrder[] = [
  { id: "EO-48213", customer: { ar: "منى عادل", en: "Mona Adel" }, area: { ar: "مدينة نصر، القاهرة", en: "Nasr City, Cairo" }, phone: "+201001234821", payment: "cod", total: "1150.00", risk: 82, status: "pending", minutesAgo: 6 },
  { id: "EO-48212", customer: { ar: "كريم السيد", en: "Karim El-Sayed" }, area: { ar: "سموحة، الإسكندرية", en: "Smouha, Alexandria" }, phone: "+201112223334", payment: "card", total: "2480.00", risk: 12, status: "confirmed", minutesAgo: 22 },
  { id: "EO-48209", customer: { ar: "سارة محمود", en: "Sara Mahmoud" }, area: { ar: "الدقي، الجيزة", en: "Dokki, Giza" }, phone: "+201223344556", payment: "wallet", total: "640.50", risk: 35, status: "shipped", minutesAgo: 95 },
  { id: "EO-48204", customer: { ar: "أحمد فتحي", en: "Ahmed Fathy" }, area: { ar: "المنصورة، الدقهلية", en: "Mansoura, Dakahlia" }, phone: "+201556677889", payment: "deposit", total: "3900.00", risk: 58, status: "new", minutesAgo: 180 },
  { id: "EO-48198", customer: { ar: "نور حسن", en: "Nour Hassan" }, area: { ar: "طنطا، الغربية", en: "Tanta, Gharbia" }, phone: "+201009876543", payment: "bnpl", total: "5200.00", risk: 21, status: "delivered", minutesAgo: 1440 },
  { id: "EO-48190", customer: { ar: "يوسف إبراهيم", en: "Youssef Ibrahim" }, area: { ar: "أسيوط", en: "Assiut" }, phone: "+201287654321", payment: "cod", total: "780.00", risk: 74, status: "refused", minutesAgo: 2880 },
  { id: "EO-48187", customer: { ar: "هالة مصطفى", en: "Hala Mostafa" }, area: { ar: "المعادي، القاهرة", en: "Maadi, Cairo" }, phone: "+201033445566", payment: "bank_transfer", total: "12500.00", risk: 8, status: "delivered", minutesAgo: 4320 },
];

export const CITIES: ReadonlyArray<{ value: string } & Text> = [
  { value: "cairo", ar: "القاهرة", en: "Cairo" },
  { value: "giza", ar: "الجيزة", en: "Giza" },
  { value: "alexandria", ar: "الإسكندرية", en: "Alexandria" },
  { value: "mansoura", ar: "المنصورة", en: "Mansoura" },
  { value: "tanta", ar: "طنطا", en: "Tanta" },
  { value: "assiut", ar: "أسيوط", en: "Assiut" },
  { value: "luxor", ar: "الأقصر", en: "Luxor" },
  { value: "aswan", ar: "أسوان", en: "Aswan" },
  { value: "port-said", ar: "بورسعيد", en: "Port Said" },
  { value: "suez", ar: "السويس", en: "Suez" },
  { value: "hurghada", ar: "الغردقة", en: "Hurghada" },
  { value: "zagazig", ar: "الزقازيق", en: "Zagazig" },
];

/** Net profit per day, last 14 days (EGP). */
export const PROFIT_TREND = [8200, 9100, 7600, 10400, 9800, 11200, 10900, 12100, 11400, 12800, 13300, 12600, 14100, 14820];
export const RTO_TREND = [24, 23, 25, 22, 21, 21, 20, 19, 19, 18, 18, 17, 17, 16.4];

/** A sample WhatsApp confirmation for the studio's phone (E6-16b): the template, a tap, the reply. */
export const PHONE_CHATS: Record<"ar" | "en", { store: string; turns: PhoneTurn[] }> = {
  ar: {
    store: "متجر النيل",
    turns: [
      { from: "business", kind: "template", editable: false, body: "أهلاً منى 👋\nأوردرك رقم #1001 من متجر النيل وصلنا.\nالإجمالي 1,250 ج.م عند الاستلام.\nأكّد الأوردر عشان نجهّزه ونشحنه لك.", buttons: ["أكّد الأوردر", "عايز أعدّل", "ألغي الأوردر"] },
      { from: "customer", kind: "tap", editable: false, text: "أكّد الأوردر" },
      { from: "business", kind: "buttons", key: "offer_pitch", editable: true, body: "*تمام ✅* أوردرك #1001 اتأكّد.\n🎁 عرض ليك: طرحة مطابقة بـ 135 ج.م بدل ~150 ج.م~.\nتحب نضيفه لنفس الأوردر؟", footer: "متجر النيل", buttons: ["أضفه", "لا شكراً"] },
      { from: "customer", kind: "tap", editable: false, text: "أضفه" },
      { from: "business", kind: "text", key: "offer_added", editable: true, text: "اتضافت _طرحة مطابقة_ ✨ الإجمالي الجديد 1,385 ج.م. تابع أوردرك: https://app.mizan.test/ar/c/xxxxxxxx" },
    ],
  },
  en: {
    store: "Nile Store",
    turns: [
      { from: "business", kind: "template", editable: false, body: "Hi Mona 👋\nWe received your order #1001 from Nile Store.\nTotal: EGP 1,250 on delivery.\nPlease confirm so we can prepare and ship it.", buttons: ["Confirm order", "I want a change", "Cancel order"] },
      { from: "customer", kind: "tap", editable: false, text: "Cancel order" },
      { from: "business", kind: "list", key: "cancel_prompt", editable: true, header: "Order #1001", body: "Sorry to hear that 😔 Could you tell us why you want to cancel?", footer: "Nile Store", list: { button: "Choose a reason", section: "Reasons", rows: [{ title: "Ordered by mistake" }, { title: "Found it cheaper", description: "We may match the price" }, { title: "No, keep the order" }] } },
      { from: "customer", kind: "tap", editable: false, text: "Ordered by mistake" },
      { from: "business", kind: "text", key: "cancelled", editable: true, text: "Done. Order #1001 is *cancelled*. We hope to see you again soon." },
    ],
  },
};
