import { convertMoney, fromMinor, percentOf, toMinor, type Money } from "@mizan/shared";

/**
 * Profit for one order (M5, E9-2), as a pure function of what is known about it: no database,
 * no clock, no floats. Rules (docs/04 §5):
 *
 *   revenue    COD and the COD balance count when delivered; prepaid money when it is paid.
 *              Refused or cancelled COD earns nothing.
 *   cogs       from confirmation on (the cost locked on the line); a returned order's goods are
 *              back in stock until inspection says otherwise (E10).
 *   shipping   from shipping on: the courier's actual fee, else its rate card.
 *   returns    a returned order: the return leg (actual, else the rate card's return price).
 *   COD fee    on delivery, a % of the cash collected (actual from settlement later).
 *   payment    each online payment: actual fee, else % + fixed for its method.
 *   agent      once confirmed. packaging: once shipped. channel fees: later (M18).
 *   ads        the order's share of its store's ad spend that day (E9-3, `spreadShare`), from
 *              the day it is placed: a refused order keeps it; a cancelled one gives it back.
 *
 * Everything is in the store's base currency; order amounts are converted with the rate of the
 * order's day. Without a rate the order stays in its own currency and is flagged `fx_missing`.
 * Expected profit is what the order makes if it delivers, for orders still on their way.
 */
export type OrderStage = "open" | "confirmed" | "shipped" | "delivered" | "returned" | "cancelled";

export interface PnlInput {
  stage: OrderStage;
  paymentMode: string;
  /** Order currency and amounts (minor units). */
  currency: string;
  totalMinor: bigint;
  /** Cash the courier collects (cashToCollect at sync time). */
  codMinor: bigint;
  refundedMinor: bigint;
  /** 1 order-currency unit = rate base units; null = no rate for the day. */
  rateToBase: string | null;
  base: string;
  /**
   * Unit cost in base minor units; null when the product has no cost yet. After a return is
   * inspected (E10-3): units back in stock (`restocked`) and units lost, damaged or written off.
   */
  lines: Array<{ quantity: number; unitCostMinor: bigint | null; restocked?: number; lost?: number }>;
  confirmed: boolean;
  /** Succeeded money movements in order currency. */
  payments: Array<{ kind: string; method: string; amountMinor: bigint; feeMinor: bigint; feeIsActual: boolean }>;
  /** Base-currency rules that apply on the order's day (null = none set). */
  rules: {
    packaging: Money | null;
    agent: Money | null;
    codPct: string | null;
    courier: { amount: Money | null; returnAmount: Money | null } | null;
    paymentFee: (method: string) => { pct: string; fixed: Money | null } | null;
  };
  /** This order's share of its store's ad spend for its day, base minor units (E9-3). */
  adsMinor?: bigint;
  /** Some of that day's spend is in a currency with no rate: not counted, flagged. */
  adsFxMissing?: boolean;
  /** Actual courier fees in base minor units, once known (shipments / settlement). */
  actual?: { shipping?: bigint; cod?: bigint; returnLeg?: bigint };
}

export interface Pnl {
  currency: string;
  revenue: bigint; refund: bigint; cogs: bigint; shipping: bigint; codFee: bigint; paymentFee: bigint;
  channelFee: bigint; ads: bigint; agent: bigint; packaging: bigint; rto: bigint; chargeback: bigint;
  net: bigint;
  expectedRevenue: bigint;
  expectedNet: bigint;
  isFinal: boolean;
  flags: string[];
}

const MONEY_IN = new Set(["sale", "capture", "cod_collection"]);
const PREPAID_IN = new Set(["sale", "capture"]);
const SHIPPED = new Set<OrderStage>(["shipped", "delivered", "returned"]);
const COLLECTS = new Set(["cod", "partial"]);

export function computePnl(i: PnlInput): Pnl {
  const flags = new Set<string>();
  const known = i.rateToBase !== null || i.currency === i.base;
  if (!known) flags.add("fx_missing");
  const currency = known ? i.base : i.currency;
  /** An order-currency amount in the P&L currency. */
  const conv = (minor: bigint): bigint => {
    if (!known || i.currency === i.base) return minor;
    return toMinor(convertMoney(fromMinor(minor, i.currency), i.base, i.rateToBase!));
  };
  /** A base-currency rule amount; without a rate the order stays in its own currency, so rule costs can't apply. */
  const rule = (m: Money | null | undefined, missingFlag: string): bigint => {
    if (!m) { flags.add(missingFlag); return 0n; }
    if (!known) return 0n;
    flags.add("estimated");
    return toMinor(m);
  };
  const shipped = SHIPPED.has(i.stage);
  const cancelled = i.stage === "cancelled";
  const collects = COLLECTS.has(i.paymentMode);

  // Revenue: prepaid money when paid; COD cash when delivered.
  const prepaidIn = i.payments.filter((p) => PREPAID_IN.has(p.kind)).reduce((a, p) => a + p.amountMinor, 0n);
  // Once delivered, the cash is what the courier collected (ledger cod_collection lines: the courier's,
  // or the store's "marked paid") plus what is still recorded as owed (the order's cod).
  const codCollected = i.payments.filter((p) => p.kind === "cod_collection").reduce((a, p) => a + p.amountMinor, 0n);
  const codIn = collects && i.stage === "delivered" ? codCollected + i.codMinor : 0n;
  const revenue = conv(prepaidIn + codIn);
  const refund = conv(i.refundedMinor);
  const chargeback = conv(i.payments.filter((p) => p.kind === "chargeback").reduce((a, p) => a + p.amountMinor, 0n));

  // Product cost, from confirmation on. A returned order's goods are back in stock except the
  // units inspection found damaged or wrote off (E10-3); a delivered order's units the customer
  // sent back sellable come off its cost.
  const countsCogs = i.confirmed && !cancelled && i.stage !== "returned" && i.stage !== "open";
  let cogsAll = 0n;
  let restockedCost = 0n;
  let lostCost = 0n;
  let inspected = 0;
  let units = 0;
  for (const l of i.lines) {
    units += l.quantity;
    inspected += (l.restocked ?? 0) + (l.lost ?? 0);
    if (l.unitCostMinor === null) {
      if ((!cancelled && i.stage !== "returned") || (i.stage === "returned" && (l.lost ?? 0) > 0)) flags.add("cost_missing");
      continue;
    }
    cogsAll += l.unitCostMinor * BigInt(l.quantity);
    restockedCost += l.unitCostMinor * BigInt(Math.min(l.restocked ?? 0, l.quantity));
    lostCost += l.unitCostMinor * BigInt(Math.min(l.lost ?? 0, l.quantity));
  }
  if (!known) { cogsAll = 0n; restockedCost = 0n; lostCost = 0n; }
  const cogs = countsCogs ? cogsAll - restockedCost : i.stage === "returned" ? lostCost : 0n;
  if (i.stage === "returned" && inspected < units) flags.add("awaiting_inspection");

  const courierAmount = (actual: bigint | undefined, m: Money | null | undefined) => (actual !== undefined ? actual : rule(m, "shipping_rate_missing"));
  const shipping = shipped ? courierAmount(i.actual?.shipping, i.rules.courier?.amount) : 0n;
  const rto = i.stage === "returned" ? (i.actual?.returnLeg !== undefined ? i.actual.returnLeg : rule(i.rules.courier?.returnAmount ?? null, "return_rate_missing")) : 0n;
  const codFeeOf = (cash: bigint): bigint => {
    if (i.actual?.cod !== undefined) return i.actual.cod;
    if (!i.rules.codPct) { flags.add("cod_fee_missing"); return 0n; }
    if (!known) return 0n;
    flags.add("estimated");
    return toMinor(percentOf(fromMinor(conv(cash), i.base), i.rules.codPct));
  };
  const codFee = codIn > 0n ? codFeeOf(codIn) : 0n;

  let paymentFee = 0n;
  for (const p of i.payments) {
    if (!MONEY_IN.has(p.kind) || p.kind === "cod_collection") continue;
    if (p.feeIsActual) { paymentFee += conv(p.feeMinor); continue; }
    const fee = i.rules.paymentFee(p.method);
    if (!fee) { flags.add("payment_fee_missing"); continue; }
    if (!known) continue;
    flags.add("estimated");
    paymentFee += toMinor(percentOf(fromMinor(conv(p.amountMinor), i.base), fee.pct)) + (fee.fixed ? toMinor(fee.fixed) : 0n);
  }

  const agent = i.confirmed ? rule(i.rules.agent, "agent_cost_missing") : 0n;
  const packaging = shipped ? rule(i.rules.packaging, "packaging_cost_missing") : 0n;
  const ads = known && !cancelled ? (i.adsMinor ?? 0n) : 0n;
  if (i.adsFxMissing && !cancelled) flags.add("ads_fx_missing");
  const channelFee = 0n;
  const costs = cogs + shipping + codFee + paymentFee + channelFee + ads + agent + packaging + rto + chargeback;
  const net = revenue - refund - costs;

  // Expected: what this order makes if it delivers (still-moving orders only): its full total,
  // and the costs still to come (product, shipping, packaging, agent, COD fee) at today's rules.
  const moving = !cancelled && i.stage !== "returned" && i.stage !== "delivered";
  const expectedRevenue = moving ? conv(i.totalMinor) - refund : revenue - refund;
  let expectedNet = net;
  if (moving && !known) expectedNet = expectedRevenue - costs; // in the order's own currency, no store costs
  if (moving && known) {
    const later = (m: Money | null | undefined) => (m ? toMinor(m) : 0n);
    const extraCogs = countsCogs ? 0n : cogsAll;
    const extraShip = shipped ? 0n : (i.actual?.shipping ?? later(i.rules.courier?.amount));
    const extraPack = shipped ? 0n : later(i.rules.packaging);
    const extraAgent = i.confirmed ? 0n : later(i.rules.agent);
    const extraCod = collects && i.codMinor > 0n && i.rules.codPct ? toMinor(percentOf(fromMinor(conv(i.codMinor), i.base), i.rules.codPct)) : 0n;
    expectedNet = expectedRevenue - costs - extraCogs - extraShip - extraPack - extraAgent - extraCod;
  }

  // Final once nothing can change it: a cancelled order with no money moved. Delivered and
  // returned orders become final with settlement (M8) and inspection (E10).
  const isFinal = cancelled && !shipped && i.payments.length === 0;
  if (!isFinal && (i.stage === "delivered" || i.stage === "returned")) flags.add("awaiting_settlement");
  return {
    currency, revenue, refund, cogs, shipping, codFee, paymentFee, channelFee, ads, agent, packaging, rto, chargeback, net,
    expectedRevenue, expectedNet, isFinal, flags: [...flags].sort(),
  };
}

/** The P&L stage of an order from its status and timestamps. */
export function stageOf(status: string, shipped: boolean): OrderStage {
  switch (status) {
    case "confirmed": return "confirmed";
    case "shipped": return "shipped";
    case "delivered": return "delivered";
    case "returned": return "returned";
    case "cancelled": return shipped ? "returned" : "cancelled";
    default: return "open";
  }
}

/**
 * One order's share of a day's spend over `count` orders, by its place (0-based) in a stable
 * order: equal parts in minor units, the remainder one unit each to the first ones, so the
 * shares of a day add up to the spend exactly.
 */
export function spreadShare(totalMinor: bigint, count: number, rank: number): bigint {
  if (count <= 0 || rank < 0 || rank >= count || totalMinor <= 0n) return 0n;
  const n = BigInt(count);
  return totalMinor / n + (BigInt(rank) < totalMinor % n ? 1n : 0n);
}
