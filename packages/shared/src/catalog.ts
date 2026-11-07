/**
 * The integration and payment-method catalogue (docs/16 §5.6 #8, X9): one constant that every
 * screen reads instead of its own hard-coded list (the payment mix, the notification bell, Settings →
 * Costs, Settings → Integrations). `GET /v1/integrations/catalog` serves the same constant when the
 * connections map lands (CN lane); adding a provider or a method here is the one change needed.
 *
 * Arabic names are written in Arabic, as the screens already say them ("شوبيفاي"), so Arabic pages
 * carry no Latin words outside <bdi>.
 */

export type ProviderKind = "store" | "courier" | "messaging" | "gateway";
export type ProviderAvailability = "connect" | "manual" | "coming_soon";

export interface ProviderEntry {
  slug: string;
  kind: ProviderKind;
  nameEn: string;
  nameAr: string;
  /** ISO country codes where it is offered. */
  markets: readonly string[];
  availability: ProviderAvailability;
}

export const PROVIDER_CATALOG = [
  { slug: "shopify", kind: "store", nameEn: "Shopify", nameAr: "شوبيفاي", markets: ["EG", "SA", "AE"], availability: "connect" },
  { slug: "woocommerce", kind: "store", nameEn: "WooCommerce", nameAr: "ووكومرس", markets: ["EG", "SA", "AE"], availability: "connect" },
  { slug: "bosta", kind: "courier", nameEn: "Bosta", nameAr: "بوسطة", markets: ["EG", "SA"], availability: "connect" },
  { slug: "manual", kind: "courier", nameEn: "Courier recorded by hand", nameAr: "شركة شحن بتتسجّل بإيدك", markets: ["EG", "SA", "AE"], availability: "manual" },
  { slug: "whatsapp_cloud", kind: "messaging", nameEn: "WhatsApp", nameAr: "واتساب", markets: ["EG", "SA", "AE"], availability: "connect" },
  { slug: "paymob", kind: "gateway", nameEn: "Paymob", nameAr: "باي موب", markets: ["EG", "SA", "AE"], availability: "coming_soon" },
] as const satisfies readonly ProviderEntry[];

export type ProviderSlug = (typeof PROVIDER_CATALOG)[number]["slug"];
export const PROVIDER_SLUGS: readonly ProviderSlug[] = PROVIDER_CATALOG.map((p) => p.slug);
export const isProviderSlug = (s: string): s is ProviderSlug => (PROVIDER_SLUGS as readonly string[]).includes(s);

/**
 * How a customer can pay (docs/12-payments.md). `feeRule`: the store sets a percentage fee for it in
 * Settings → Costs (cash methods and store credit carry none; marketplace fees come from the payout).
 */
export interface PaymentMethodEntry {
  slug: string;
  /** Collected by the courier at the door. */
  atDoor: boolean;
  feeRule: boolean;
}

export const PAYMENT_METHOD_CATALOG = [
  { slug: "cod", atDoor: true, feeRule: false },
  { slug: "card", atDoor: false, feeRule: true },
  { slug: "wallet", atDoor: false, feeRule: true },
  { slug: "apple_pay", atDoor: false, feeRule: true },
  { slug: "bnpl", atDoor: false, feeRule: true },
  { slug: "bank_transfer", atDoor: false, feeRule: true },
  { slug: "instapay", atDoor: false, feeRule: true },
  { slug: "fawry_ref", atDoor: false, feeRule: false },
  { slug: "store_credit", atDoor: false, feeRule: false },
  { slug: "cash_pos", atDoor: false, feeRule: false },
  { slug: "marketplace", atDoor: false, feeRule: false },
] as const satisfies readonly PaymentMethodEntry[];

export type PaymentMethodSlug = (typeof PAYMENT_METHOD_CATALOG)[number]["slug"];
export const PAYMENT_METHOD_SLUGS: readonly PaymentMethodSlug[] = PAYMENT_METHOD_CATALOG.map((m) => m.slug);
export const isPaymentMethodSlug = (s: string): s is PaymentMethodSlug => (PAYMENT_METHOD_SLUGS as readonly string[]).includes(s);
/** Methods a store can give a fee percentage, in the order Settings → Costs lists them. */
export const FEE_METHOD_SLUGS = PAYMENT_METHOD_CATALOG.filter((m) => m.feeRule).map((m) => m.slug);

/**
 * Codes the server stores where it has no name, translated by the screens (docs/16 §4, FX-1): never
 * an English word saved as data. `STORE_COURIER`: a parcel marked shipped in the store without a
 * courier's name. `NO_CUSTOMER_NAME`: the placeholder connectors give an order without a buyer name
 * (the courier still needs one); Mizan stores no name instead and the screens say "no name".
 */
export const STORE_COURIER = "store_courier";
export const NO_CUSTOMER_NAME = "Customer";

/**
 * Order-profit flags that mean an input is missing (docs/04 profit rules, FX-2): the store has to set
 * something before the profit is final. One list for the API (the period's quality) and the screens
 * (the order's profit card), so they never disagree. `estimated` and `awaiting_settlement` are not
 * here: those are on their way, not missing. `fx_missing` keeps the order in its own currency, so it
 * counts whatever the order's currency.
 */
export const COST_FLAGS = ["cost_missing", "shipping_rate_missing", "cod_fee_missing", "payment_fee_missing", "agent_cost_missing", "packaging_cost_missing", "return_rate_missing", "fx_missing", "ads_fx_missing"] as const;
export type CostFlag = (typeof COST_FLAGS)[number];
/** The buyer's real name, or null for none or the connectors' placeholder. */
export const realCustomerName = (name: string | null | undefined): string | null => {
  const n = name?.trim();
  return n && n !== NO_CUSTOMER_NAME ? n : null;
};
