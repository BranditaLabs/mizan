import { fromMinor, type Money } from "@mizan/shared";
import { multiple, perUnit } from "../attribution/roas.js";
import { percent } from "../profit/home.js";

/**
 * The semantic metric layer (M20, E15-1): every number a screen, report or alert shows is defined
 * once, here, with tests — never as ad-hoc SQL in a screen (docs/modules/M20). A definition reads
 * `MetricFacts` (gathered once per period by MetricsService) and says who may see it; when a
 * definition changes, its version goes up.
 *
 * The period is store days (orders by the day they were placed, in the store's time zone), the same
 * as the profit home, so the same metric shows the same value on every screen.
 */
export interface MetricFacts {
  base: string;
  days: number;
  /** Orders placed in the period, cancelled ones left out (every currency). */
  live: bigint;
  /** Of those, paid before delivery (card, wallet, BNPL, transfer, store credit) and cash on delivery (incl. deposit + cash). */
  prepaid: bigint;
  cod: bigint;
  /** Orders that reached an end in the courier's hands (base-currency profit rows, as the home). */
  delivered: bigint;
  returned: bigint;
  /** Base currency minor units, from order profit. */
  net: bigint;
  /** Of that, the orders that reached an end (delivered, or refused and returned): no order still moving. */
  netEnded: bigint;
  revenue: bigint;
  refunds: bigint;
  /** Ad spend in the period, base currency (each day at its rate; days without a rate left out). */
  spend: bigint;
  /** Order totals in the base currency and how many orders they cover. */
  totalBase: bigint;
  ordersBase: bigint;
  /** Units available in stock now (counted items), and units shipped in the period. */
  available: bigint;
  unitsShipped: bigint;
  /**
   * Orders placed in the period that were confirmed (confirmed or further, or confirmed then
   * cancelled: the confirmation analytics' test), and of those the ones confirmed with no person
   * involved: a confirmed attempt (`confirmations`) by the routing rule, or the customer answering an
   * automated channel (WhatsApp bot, link page, SMS link, automated or AI call). An attempt with a
   * team member, by the team's call or the order screen, or no attempt at all (confirmed from the
   * store, an exchange's replacement) is not automated.
   */
  confirmed: bigint;
  confirmedAuto: bigint;
  /**
   * Profit honesty (FX-2): the period's orders (not cancelled, base currency) whose profit misses an
   * input (a product cost, a courier rate, a fee, an FX rate), and the distinct products in them that
   * have no cost yet.
   */
  ordersMissingCosts: bigint;
  productsMissingCost: bigint;
}

/** Order-profit flags that mean an input is missing: one list in @mizan/shared for the API and the screens. */
export { COST_FLAGS } from "@mizan/shared";

/** How far a profit figure can be trusted (docs/16 §4.1 honesty rule), the same on every screen. */
export interface ProfitQuality {
  /** No order of the period misses a cost. */
  costsComplete: boolean;
  /** At least one order of the period was delivered (money that is real). */
  delivered: boolean;
  /** Costs missing or nothing delivered: the screens say "Provisional profit" and never show a margin. */
  provisional: boolean;
  ordersMissingCosts: number;
  productsMissingCost: number;
}

export function profitQuality(f: { ordersMissingCosts: bigint | number; productsMissingCost: bigint | number; delivered: bigint | number }): ProfitQuality {
  const missing = Number(f.ordersMissingCosts);
  const costsComplete = missing === 0;
  const delivered = Number(f.delivered) > 0;
  return { costsComplete, delivered, provisional: !costsComplete || !delivered, ordersMissingCosts: missing, productsMissingCost: Number(f.productsMissingCost) };
}

export type MetricUnit = "count" | "percent" | "money" | "days" | "multiple";
export interface MetricValue { value: string | null; money?: Money | null; numerator?: string; denominator?: string }
export interface MetricDefinition {
  key: string;
  version: number;
  unit: MetricUnit;
  module: string;
  name: { en: string; ar: string };
  definition: { en: string; ar: string };
  /** Roles that see it; the rest never get it (hidden, not zero). */
  roles: ReadonlySet<string>;
  /** Built on order profit: provisional while costs are missing or nothing is delivered (FX-2). */
  profit?: boolean;
  compute(f: MetricFacts): MetricValue;
}

const MANAGERS = new Set(["owner", "admin", "ops_manager", "finance"]);
const MONEY_READERS = new Set(["owner", "admin", "ops_manager", "finance"]);
const STOCK_READERS = new Set(["owner", "admin", "ops_manager", "finance", "warehouse"]);
const ALL = new Set(["owner", "admin", "ops_manager", "finance", "agent", "warehouse"]);

const ratio = (part: bigint, whole: bigint): MetricValue => ({ value: percent(part, whole), numerator: String(part), denominator: String(whole) });
/** a ÷ b to one decimal, half away from zero; null when b is 0. */
function divide(a: bigint, b: bigint): string | null {
  if (b === 0n) return null;
  const tenths = (a * 20n + b) / (2n * b);
  return `${tenths / 10n}.${tenths % 10n}`;
}

/** a ÷ b in minor units, half away from zero (net profit can be a loss); null when b is 0. */
export function perUnitSigned(a: bigint, b: bigint): bigint | null {
  if (b === 0n) return null;
  const neg = (a < 0n) !== (b < 0n);
  const x = a < 0n ? -a : a;
  const y = b < 0n ? -b : b;
  const q = (x * 2n + y) / (2n * y);
  return neg ? -q : q;
}

/** The delivered share of orders that reached an end: the one formula every screen uses. */
export const deliveredRate = (delivered: bigint, returned: bigint) => percent(delivered, delivered + returned);

export const METRICS: readonly MetricDefinition[] = [
  {
    key: "orders", version: 1, unit: "count", module: "M1", roles: ALL,
    name: { en: "Orders", ar: "الأوردرات" },
    definition: { en: "Orders placed in the period, cancelled ones left out.", ar: "الأوردرات اللي اتعملت في الفترة، من غير الملغية." },
    compute: (f) => ({ value: String(f.live) }),
  },
  {
    key: "delivered_rate", version: 1, unit: "percent", module: "M3", roles: MANAGERS,
    name: { en: "Delivered rate", ar: "نسبة التسليم" },
    definition: { en: "Delivered ÷ orders that reached an end (delivered, or refused and returned).", ar: "اللي اتسلّم ÷ الأوردرات اللي وصلت لنهاية (اتسلّمت، أو اترفضت ورجعت)." },
    compute: (f) => ({ value: deliveredRate(f.delivered, f.returned), numerator: String(f.delivered), denominator: String(f.delivered + f.returned) }),
  },
  {
    key: "rto_rate", version: 1, unit: "percent", module: "M3", roles: MANAGERS,
    name: { en: "Return rate (RTO)", ar: "نسبة المرتجع" },
    definition: { en: "Refused and returned ÷ orders that reached an end.", ar: "اللي اترفض ورجع ÷ الأوردرات اللي وصلت لنهاية." },
    compute: (f) => ratio(f.returned, f.delivered + f.returned),
  },
  {
    key: "prepaid_share", version: 1, unit: "percent", module: "M15", roles: MANAGERS,
    name: { en: "Prepaid share", ar: "نسبة المدفوع مقدّم" },
    definition: { en: "Orders paid before delivery (card, wallet, BNPL, transfer, store credit) ÷ orders.", ar: "الأوردرات المدفوعة قبل التوصيل (كارت، محفظة، تقسيط، تحويل، رصيد) ÷ الأوردرات." },
    compute: (f) => ratio(f.prepaid, f.live),
  },
  {
    key: "cod_share", version: 1, unit: "percent", module: "M15", roles: MANAGERS,
    name: { en: "Cash on delivery share", ar: "نسبة الدفع عند الاستلام" },
    definition: { en: "Orders with cash to collect on delivery (including deposit + cash) ÷ orders.", ar: "الأوردرات اللي فيها كاش يتحصّل عند الاستلام (ومعاها عربون + كاش) ÷ الأوردرات." },
    compute: (f) => ratio(f.cod, f.live),
  },
  {
    key: "net_profit", version: 1, unit: "money", module: "M5", roles: MONEY_READERS, profit: true,
    name: { en: "Net profit", ar: "صافي الربح" },
    definition: { en: "Sum of the period's orders' net profit (money that is real: COD once delivered).", ar: "مجموع صافي ربح أوردرات الفترة (الفلوس الحقيقية: الكاش بعد التسليم)." },
    compute: (f) => { const m = fromMinor(f.net, f.base); return { value: m.amount, money: m }; },
  },
  {
    key: "average_order_value", version: 1, unit: "money", module: "M1", roles: MONEY_READERS,
    name: { en: "Average order value", ar: "متوسط قيمة الأوردر" },
    definition: { en: "Order totals ÷ orders, in the store's currency (orders in another currency without a rate left out).", ar: "إجمالي الأوردرات ÷ عددها، بعملة المتجر (من غير الأوردرات بعملة تانية ملهاش سعر صرف)." },
    compute: (f) => {
      if (f.ordersBase === 0n) return { value: null, money: null, numerator: String(f.totalBase), denominator: "0" };
      const m = fromMinor((f.totalBase * 2n + f.ordersBase) / (2n * f.ordersBase), f.base);
      return { value: m.amount, money: m, numerator: String(f.totalBase), denominator: String(f.ordersBase) };
    },
  },
  {
    key: "ad_spend", version: 1, unit: "money", module: "M7", roles: MONEY_READERS,
    name: { en: "Ad spend", ar: "مصروف الإعلانات" },
    definition: { en: "Ad spend entered or imported for the period, in the store's currency at each day's rate.", ar: "مصروف الإعلانات المتسجّل أو المستورد في الفترة، بعملة المتجر بسعر صرف كل يوم." },
    compute: (f) => { const m = fromMinor(f.spend, f.base); return { value: m.amount, money: m }; },
  },
  {
    key: "true_roas", version: 1, unit: "multiple", module: "M7", roles: MONEY_READERS,
    name: { en: "True ROAS", ar: "العائد الحقيقي من الإعلانات" },
    definition: { en: "Money that is real (paid, or cash delivered, less refunds) from the period's orders ÷ ad spend.", ar: "الفلوس الحقيقية (المدفوعة، أو الكاش اللي اتسلّم، ناقص المرتجع) من أوردرات الفترة ÷ مصروف الإعلانات." },
    compute: (f) => ({ value: multiple(f.revenue - f.refunds, f.spend), numerator: String(f.revenue - f.refunds), denominator: String(f.spend) }),
  },
  {
    key: "cost_per_delivered_order", version: 1, unit: "money", module: "M7", roles: MONEY_READERS,
    name: { en: "Ad cost per delivered order", ar: "تكلفة الإعلان لكل أوردر اتسلّم" },
    definition: { en: "Ad spend ÷ the period's delivered orders.", ar: "مصروف الإعلانات ÷ أوردرات الفترة اللي اتسلّمت." },
    compute: (f) => {
      const v = perUnit(f.spend, f.delivered);
      const m = v === null ? null : fromMinor(v, f.base);
      return { value: m?.amount ?? null, money: m, numerator: String(f.spend), denominator: String(f.delivered) };
    },
  },
  {
    key: "profit_per_completed_order", version: 1, unit: "money", module: "M5", roles: MONEY_READERS, profit: true,
    name: { en: "Profit per completed order", ar: "الربح لكل أوردر خلص" },
    definition: {
      en: "Net profit of the period's orders that reached an end (delivered, or refused and returned) ÷ those orders: what each finished order really left, returns' losses included. Orders still moving are left out of both.",
      ar: "صافي ربح أوردرات الفترة اللي وصلت لنهاية (اتسلّمت، أو اترفضت ورجعت) ÷ عدد الأوردرات دي: اللي كل أوردر خلص سابه فعلاً، وخسارة المرتجع محسوبة. الأوردرات اللي لسه في الطريق مش محسوبة في الاتنين.",
    },
    compute: (f) => {
      const v = perUnitSigned(f.netEnded, f.delivered + f.returned);
      const m = v === null ? null : fromMinor(v, f.base);
      return { value: m?.amount ?? null, money: m, numerator: String(f.netEnded), denominator: String(f.delivered + f.returned) };
    },
  },
  {
    key: "automation_share", version: 1, unit: "percent", module: "M2", roles: MANAGERS,
    name: { en: "Confirmed automatically", ar: "اتأكّد أوتوماتيك" },
    definition: {
      en: "Orders confirmed with no person involved (by the routing rule, or the customer answering the WhatsApp bot, the link, an SMS or an automated call) ÷ confirmed orders of the period, as on the confirmation report. Orders confirmed from the store or by the team count as not automated.",
      ar: "الأوردرات اللي اتأكّدت من غير ما حد من الفريق يتدخّل (بقاعدة التوجيه، أو العميل ردّ على بوت واتساب أو اللينك أو رسالة أو مكالمة أوتوماتيك) ÷ الأوردرات اللي اتأكّدت في الفترة، زي تقرير التأكيد. اللي اتأكّد من المتجر أو من الفريق مش أوتوماتيك.",
    },
    compute: (f) => ratio(f.confirmedAuto, f.confirmed),
  },
  {
    key: "days_of_cover", version: 1, unit: "days", module: "M4", roles: STOCK_READERS,
    name: { en: "Days of cover", ar: "أيام تكفّي المخزون" },
    definition: { en: "Units available now ÷ average units shipped per day over the period.", ar: "القطع المتاحة دلوقتي ÷ متوسط القطع اللي اتشحنت في اليوم خلال الفترة." },
    compute: (f) => ({ value: divide(f.available * BigInt(f.days), f.unitsShipped), numerator: String(f.available), denominator: f.unitsShipped === 0n ? "0" : `${f.unitsShipped}/${f.days}` }),
  },
];

export const METRIC_KEYS = METRICS.map((m) => m.key);
export const metricByKey = new Map(METRICS.map((m) => [m.key, m]));
