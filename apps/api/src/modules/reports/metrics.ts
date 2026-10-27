import { fromMinor, type Money } from "@mizan/shared";
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
  revenue: bigint;
  /** Order totals in the base currency and how many orders they cover. */
  totalBase: bigint;
  ordersBase: bigint;
  /** Units available in stock now (counted items), and units shipped in the period. */
  available: bigint;
  unitsShipped: bigint;
}

export type MetricUnit = "count" | "percent" | "money" | "days";
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
    key: "net_profit", version: 1, unit: "money", module: "M5", roles: MONEY_READERS,
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
    key: "days_of_cover", version: 1, unit: "days", module: "M4", roles: STOCK_READERS,
    name: { en: "Days of cover", ar: "أيام تكفّي المخزون" },
    definition: { en: "Units available now ÷ average units shipped per day over the period.", ar: "القطع المتاحة دلوقتي ÷ متوسط القطع اللي اتشحنت في اليوم خلال الفترة." },
    compute: (f) => ({ value: divide(f.available * BigInt(f.days), f.unitsShipped), numerator: String(f.available), denominator: f.unitsShipped === 0n ? "0" : `${f.unitsShipped}/${f.days}` }),
  },
];

export const METRIC_KEYS = METRICS.map((m) => m.key);
export const metricByKey = new Map(METRICS.map((m) => [m.key, m]));
