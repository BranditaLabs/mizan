import { safeNext } from "@/lib/next-path";

/**
 * The query of the screens before a store (sign-in, welcome), read on the server: every value
 * is allow-listed and mapped to an enum, never echoed. Email, phone and name never travel in a URL.
 */
export type Plan = "growth" | "scale";
export type Interval = "month" | "year";
export type Reason = "expired" | "reset" | "verified" | "disabled" | "invite" | "welcome" | "twoStep" | "shopify" | "shopifyGeneric";

export type AuthParams = {
  next: string;
  mode: "signin" | "create";
  plan: Plan;
  /** The landing asked for Enterprise: the trial is Scale's and the copy says we'll be in touch. */
  enterprise: boolean;
  interval: Interval;
  reason: Reason | null;
  enrolled: boolean;
  /** The Shopify shop being installed, only when it is a real `*.myshopify.com` name. */
  shop: string | null;
};

type Raw = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim();

const PLAN: Record<string, Plan> = { growth: "growth", scale: "scale", enterprise: "scale" };
const BILLING: Record<string, Interval> = { monthly: "month", month: "month", yearly: "year", year: "year", annual: "year", annually: "year" };
const REASONS = new Set(["expired", "reset", "verified", "disabled"]);
const SHOP = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

export function parsePlan(v: string | undefined): { plan: Plan; enterprise: boolean } {
  const k = (v ?? "").toLowerCase();
  return { plan: PLAN[k] ?? "growth", enterprise: k === "enterprise" };
}

export function parseInterval(v: string | undefined): Interval {
  return BILLING[(v ?? "").toLowerCase()] ?? "month";
}

/** The banner a `next` implies: sent from an invitation, the welcome page, two-step or a Shopify install. */
export function reasonFromNext(next: string): { reason: Reason | null; shop: string | null } {
  if (next.startsWith("/welcome?invite=")) return { reason: "invite", shop: null };
  if (next === "/welcome" || next.startsWith("/welcome?") || next.startsWith("/welcome/")) return { reason: "welcome", shop: null };
  if (next.startsWith("/security/two-step")) return { reason: "twoStep", shop: null };
  if (next.startsWith("/integrations/shopify/connect")) {
    const shop = new URLSearchParams(next.split("?")[1] ?? "").get("shop")?.toLowerCase() ?? "";
    return SHOP.test(shop) ? { reason: "shopify", shop } : { reason: "shopifyGeneric", shop: null };
  }
  return { reason: null, shop: null };
}

export function parseAuthParams(q: Raw): AuthParams {
  const next = safeNext(one(q.next));
  const { plan, enterprise } = parsePlan(one(q.plan));
  const asked = one(q.reason)?.toLowerCase();
  const implied = reasonFromNext(next);
  return {
    next,
    mode: one(q.mode)?.toLowerCase() === "signup" ? "create" : "signin",
    plan,
    enterprise,
    interval: parseInterval(one(q.billing)),
    reason: asked && REASONS.has(asked) ? (asked as Reason) : implied.reason,
    enrolled: one(q.enrolled) === "1",
    shop: implied.shop,
  };
}

/** The invitation id in `?invite=`: a strict uuid or the "unknown" sentinel (anything else is dropped). */
export function parseInvite(v: string | string[] | undefined): string | null {
  const s = one(v)?.toLowerCase() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s) || s === "unknown" ? s : null;
}

/**
 * The query a language switch keeps: the allow-listed params only, re-serialised from their
 * parsed values (never `location.search` copied raw). Defaults are left out to keep links short.
 */
export function carriedQuery(search: string): string {
  const q = new URLSearchParams(search);
  const raw: Raw = Object.fromEntries(q.entries());
  const out = new URLSearchParams();
  const nextRaw = one(raw.next);
  if (nextRaw && safeNext(nextRaw) !== "/") out.set("next", safeNext(nextRaw));
  else if (nextRaw === "/") out.set("next", "/");
  if (one(raw.mode)?.toLowerCase() === "signup") out.set("mode", "signup");
  if (raw.plan !== undefined) {
    const p = parsePlan(one(raw.plan));
    out.set("plan", p.enterprise ? "enterprise" : p.plan);
  }
  if (raw.billing !== undefined) out.set("billing", parseInterval(one(raw.billing)) === "year" ? "yearly" : "monthly");
  const reason = one(raw.reason)?.toLowerCase();
  if (reason && REASONS.has(reason)) out.set("reason", reason);
  if (one(raw.enrolled) === "1") out.set("enrolled", "1");
  const invite = parseInvite(raw.invite);
  if (invite) out.set("invite", invite);
  const s = out.toString();
  return s ? `?${s}` : "";
}
