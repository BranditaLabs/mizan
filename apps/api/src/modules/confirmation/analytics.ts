import { percent } from "../profit/home.js";

/**
 * Confirmation analytics (E6-6), pure: how the orders that went through confirmation in a period
 * ended, by route (E6-2: auto, bot, agent, hold) and by the channel that got the answer. No clock,
 * no personal data: counts, rates and minutes only.
 */
export const ROUTES = ["auto", "bot", "agent", "hold"] as const;
export type RouteKey = (typeof ROUTES)[number];
/** Who got the answer: a channel of the cascade, the team, or the store itself (cancelled in Shopify, paid). */
export const ANSWER_CHANNELS = ["auto", "whatsapp", "link", "call_team", "call_auto", "voice_ai", "agent", "store"] as const;
export type AnswerChannelKey = (typeof ANSWER_CHANNELS)[number];

export interface ConfirmationFact {
  /** orders.confirm_route; null when routing is off (every order goes through the cascade). */
  route: string | null;
  status: string;
  /** The latest run's status and answering channel, when a run was started. */
  runStatus: string | null;
  answeredChannel: string | null;
  placedAt: Date;
  confirmedAt: Date | null;
}

interface Tally { orders: number; confirmed: number; cancelled: number; pending: number }
export interface RouteRow extends Tally { route: RouteKey; rate: string | null }
export interface ChannelRow { channel: AnswerChannelKey; confirmed: number; cancelled: number }
export interface ConfirmationSummary extends Tally {
  /** Confirmed ÷ (confirmed + cancelled), one decimal; null before anything is decided. */
  rate: string | null;
  /** Orders waiting on the team: a refusal, a change, a team call, a hold. */
  needsTeam: number;
  /** Median minutes from the order to its confirmation, for orders that were asked (auto left out). */
  medianMinutes: number | null;
  byRoute: RouteRow[];
  byChannel: ChannelRow[];
}

const CONFIRMED = new Set(["confirmed", "shipped", "delivered", "returned"]);

export function outcomeOf(f: Pick<ConfirmationFact, "status" | "confirmedAt">): "confirmed" | "cancelled" | "pending" {
  if (CONFIRMED.has(f.status) || (f.status !== "cancelled" && f.confirmedAt)) return "confirmed";
  if (f.status === "cancelled") return f.confirmedAt ? "confirmed" : "cancelled"; // confirmed, then cancelled later: confirmation did its job
  return "pending";
}

export function routeOf(f: Pick<ConfirmationFact, "route">): RouteKey {
  return (ROUTES as readonly string[]).includes(f.route ?? "") ? (f.route as RouteKey) : "bot";
}

export function channelOf(f: Pick<ConfirmationFact, "answeredChannel" | "route">): AnswerChannelKey {
  const c = f.answeredChannel === "voice_ivr" ? "call_auto" : f.answeredChannel;
  if (c && (ANSWER_CHANNELS as readonly string[]).includes(c)) return c as AnswerChannelKey;
  return f.route === "auto" ? "auto" : "store";
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

const rateOf = (t: Tally) => percent(BigInt(t.confirmed), BigInt(t.confirmed + t.cancelled));

export function summarize(facts: readonly ConfirmationFact[]): ConfirmationSummary {
  const total: Tally = { orders: 0, confirmed: 0, cancelled: 0, pending: 0 };
  const routes = new Map<RouteKey, Tally>(ROUTES.map((r) => [r, { orders: 0, confirmed: 0, cancelled: 0, pending: 0 }]));
  const channels = new Map<AnswerChannelKey, ChannelRow>();
  const minutes: number[] = [];
  let needsTeam = 0;
  for (const f of facts) {
    const outcome = outcomeOf(f);
    const route = routeOf(f);
    for (const t of [total, routes.get(route)!]) { t.orders++; t[outcome]++; }
    if (outcome === "pending") {
      if (f.runStatus === "needs_agent") needsTeam++;
      continue;
    }
    const channel = channelOf(f);
    const row = channels.get(channel) ?? { channel, confirmed: 0, cancelled: 0 };
    row[outcome]++;
    channels.set(channel, row);
    if (outcome === "confirmed" && route !== "auto" && channel !== "auto" && f.confirmedAt) {
      minutes.push(Math.max(0, Math.round((f.confirmedAt.getTime() - f.placedAt.getTime()) / 60_000)));
    }
  }
  return {
    ...total, rate: rateOf(total), needsTeam, medianMinutes: median(minutes),
    byRoute: ROUTES.map((r) => ({ route: r, ...routes.get(r)!, rate: rateOf(routes.get(r)!) })).filter((r) => r.orders > 0),
    byChannel: ANSWER_CHANNELS.flatMap((c) => (channels.has(c) ? [channels.get(c)!] : [])),
  };
}
