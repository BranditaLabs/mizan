import type { Conditions } from "./conditions.js";
import type { Step } from "./catalog.js";

/**
 * Built-in recipes (M13, E11-2; docs/13 §3): ready automations a store installs as an editable
 * copy, off until turned on. Only what today's actions can do; recipes that need waits, payment
 * links or messages to customers arrive with those actions. Each message exists in Arabic
 * (Egyptian, for the merchant's team) and English; the store's language picks one at install.
 */
export interface Recipe {
  key: string;
  name: { ar: string; en: string };
  domain: "orders" | "verification" | "fulfilment" | "platform";
  trigger: string;
  conditions: Conditions;
  steps: (lang: "ar" | "en") => Step[];
}

const notify = (ar: string, en: string, roles: string[] = ["owner", "admin", "ops_manager"]) => (lang: "ar" | "en"): Step =>
  ({ action: "notify.team", params: { message: lang === "ar" ? ar : en, roles } });
const tag = (...tags: string[]): Step => ({ action: "order.add_tag", params: { tags } });

export const RECIPES: Recipe[] = [
  {
    key: "big_cod_order", name: { ar: "أوردرات الكاش الكبيرة", en: "Big COD orders" }, domain: "orders", trigger: "order.created",
    conditions: { all: [{ field: "order.paymentMode", op: "eq", value: "cod" }, { field: "order.total", op: "gte", value: 1500 }] },
    steps: (l) => [tag("big-cod"), notify("أوردر كاش كبير {{order.number}} بـ {{order.total}} {{order.currency}}", "Big COD order {{order.number}}: {{order.total}} {{order.currency}}")(l)],
  },
  {
    key: "risky_order_review", name: { ar: "مراجعة الأوردرات اللي فيها خطر", en: "Review risky orders" }, domain: "verification", trigger: "order.scored",
    conditions: { all: [{ field: "event.data.score", op: "gte", value: 61 }] },
    steps: (l) => [tag("review"), notify("الأوردر {{order.number}} محتاج مراجعة: درجة الخطر {{event.data.score}}", "Order {{order.number}} needs a look: risk {{event.data.score}}")(l)],
  },
  {
    key: "duplicate_guard", name: { ar: "حارس الأوردرات المكررة", en: "Duplicate guard" }, domain: "orders", trigger: "order.duplicate_found",
    conditions: { all: [] },
    steps: (l) => [tag("duplicate"), notify("الأوردر {{order.number}} شكله مكرر، راجعه قبل الشحن", "Order {{order.number}} looks like a duplicate: check it before shipping")(l)],
  },
  {
    key: "waiting_for_stock", name: { ar: "أوردرات مستنية مخزون", en: "Orders waiting for stock" }, domain: "fulfilment", trigger: "stock.short",
    conditions: { all: [] },
    steps: (l) => [tag("waiting-stock"), notify("الأوردر {{order.number}} مستني مخزون", "Order {{order.number}} is waiting for stock", ["owner", "ops_manager", "warehouse"])(l)],
  },
  {
    key: "low_stock_alert", name: { ar: "تنبيه المخزون القليل", en: "Low stock alert" }, domain: "fulfilment", trigger: "stock.low",
    conditions: { all: [] },
    steps: (l) => [notify("{{item.sku}} قرب يخلص: فاضل {{item.available}}", "{{item.sku}} is running low: {{item.available}} left", ["owner", "ops_manager", "warehouse"])(l)],
  },
  {
    key: "out_of_stock_alert", name: { ar: "تنبيه المخزون الخلصان", en: "Out of stock alert" }, domain: "fulfilment", trigger: "stock.out",
    conditions: { all: [] },
    steps: (l) => [notify("{{item.sku}} خلص من المخزن", "{{item.sku}} is out of stock", ["owner", "ops_manager", "warehouse"])(l)],
  },
  {
    key: "store_cancel_failed", name: { ar: "إلغاء ماوصلش للمتجر", en: "Cancel didn't reach the store" }, domain: "orders", trigger: "order.store_cancel_failed",
    conditions: { all: [] },
    steps: (l) => [notify("ماقدرناش نلغي الأوردر {{order.number}} على المتجر، ألغيه من هناك", "Couldn't cancel order {{order.number}} in the store: cancel it there")(l)],
  },
  {
    key: "connection_needs_attention", name: { ar: "ربط محتاج انتباه", en: "Connection needs attention" }, domain: "platform", trigger: "connection.needs_attention",
    conditions: { all: [] },
    steps: (l) => [notify("في ربط محتاج انتباه ({{event.data.provider}}): افتح الإعدادات", "A connection needs attention ({{event.data.provider}}): open Settings", ["owner", "admin"])(l)],
  },
];

export const recipe = (key: string) => RECIPES.find((r) => r.key === key);
