import type { PaymentMethod } from "@/components/ui/Badge";

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
