/**
 * Where an order came from (M7-2). Connectors copy what the store knows into `OrderSourceHints`
 * (Shopify's customer journey, WooCommerce's order attribution, note attributes, discount codes);
 * `resolveOrderSource` turns them into one answer with a ranked list of rules, the strongest
 * evidence first: an ad click id, then UTM tags, then the referring site, then the store's own
 * classification, then the sales channel. Last touch decides; the first touch is kept beside it.
 *
 * Privacy: landing URLs can carry an email or a phone in their query, so only the path, the UTM
 * tags and the click id survive; of a referrer only the domain.
 */

export const SOURCE_PLATFORMS = [
  "meta", "tiktok", "snapchat", "google", "microsoft", "x", "whatsapp", "email", "sms",
  "search", "social", "referral", "direct", "pos", "manual", "unknown",
] as const;
export type SourcePlatform = (typeof SOURCE_PLATFORMS)[number];

export const SOURCE_RULES = ["click_id", "utm", "referrer", "store", "channel", "none"] as const;
export type SourceRule = (typeof SOURCE_RULES)[number];

export const CLICK_ID_KINDS = ["fbclid", "gclid", "gbraid", "wbraid", "ttclid", "sccid", "msclkid", "twclid"] as const;
export type ClickIdKind = (typeof CLICK_ID_KINDS)[number];

export interface Utm { source?: string; medium?: string; campaign?: string; content?: string; term?: string; id?: string }

/** One visit before the order, as the store recorded it. */
export interface SourceVisit {
  landingUrl?: string;
  referrerUrl?: string;
  /** The store's own name for the source ("facebook", "google", "Instagram"). */
  source?: string;
  /** The store's classification ("SEO", "direct", "typein", "utm", "referral", "organic"). */
  sourceType?: string;
  utm?: Utm;
  occurredAt?: string;
}

/** What a connector found about an order's origin. Everything optional; nothing is guessed here. */
export interface OrderSourceHints {
  firstVisit?: SourceVisit;
  lastVisit?: SourceVisit;
  /** The sales channel the order came through ("web", "pos", "shopify_draft_order", "admin", "checkout"). */
  channel?: string;
  discountCodes?: string[];
  /** Note attributes or order meta that look like UTM tags or click ids (`utm_source`, `fbclid`…). */
  attributes?: Record<string, string>;
}

export interface OrderSource {
  platform: SourcePlatform;
  /** true: a paid ad; false: organic; null: cannot tell. */
  paid: boolean | null;
  rule: SourceRule;
  utm: Utm;
  clickId?: { kind: ClickIdKind; value: string };
  referrerDomain?: string;
  landingPath?: string;
  discountCodes: string[];
  /** The platform of the first visit, when the store reported a different first touch. */
  firstPlatform?: SourcePlatform;
  firstSeenAt?: string;
}

const PLATFORM_BY_NAME: Array<[RegExp, SourcePlatform]> = [
  [/^(fb|facebook|meta|instagram|ig|insta|messenger|an|audience[_ -]?network|facebook[_ -]?ads)$/i, "meta"],
  [/^(tiktok|tt|tiktok[_ -]?ads|tik[_ -]?tok)$/i, "tiktok"],
  [/^(snapchat|snap|sc|snapchat[_ -]?ads)$/i, "snapchat"],
  [/^(google|adwords|google[_ -]?ads|gads|youtube|yt|pmax|performance[_ -]?max|gmc|google[_ -]?shopping)$/i, "google"],
  [/^(bing|microsoft|msn|microsoft[_ -]?ads)$/i, "microsoft"],
  [/^(x|twitter|t\.co)$/i, "x"],
  [/^(whatsapp|wa|whats[_ -]?app)$/i, "whatsapp"],
  [/^(email|e-mail|newsletter|klaviyo|mailchimp|omnisend|sendgrid)$/i, "email"],
  [/^(sms|text)$/i, "sms"],
];

const PLATFORM_BY_DOMAIN: Array<[RegExp, SourcePlatform]> = [
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|instagram\.com|messenger\.com)$/, "meta"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)snapchat\.com$/, "snapchat"],
  [/(^|\.)(google\.[a-z.]+|youtube\.com|googleadservices\.com|googlesyndication\.com)$/, "google"],
  [/(^|\.)bing\.com$/, "microsoft"],
  [/(^|\.)(t\.co|x\.com|twitter\.com)$/, "x"],
  [/(^|\.)(wa\.me|whatsapp\.com)$/, "whatsapp"],
  [/(^|\.)(duckduckgo\.com|yahoo\.com|yandex\.[a-z]+|baidu\.com|ecosia\.org)$/, "search"],
  [/(^|\.)(linkedin\.com|lnkd\.in|pinterest\.[a-z.]+|reddit\.com|threads\.net|telegram\.org|t\.me)$/, "social"],
  [/(^|\.)(mail\.google\.com|outlook\.live\.com|mail\.yahoo\.com)$/, "email"],
];

const CLICK_ID_PLATFORM: Record<ClickIdKind, SourcePlatform> = {
  fbclid: "meta", gclid: "google", gbraid: "google", wbraid: "google", ttclid: "tiktok", sccid: "snapchat", msclkid: "microsoft", twclid: "x",
};

const PAID_MEDIUM = /^(cpc|ppc|cpm|cpa|cpv|paid|paid[_ -]?(social|search|media|ads?)|paidsocial|ads?|display|banner|video|retargeting|remarketing|sponsored|boosted|social[_ -]?paid)$/i;
const ORGANIC_MEDIUM = /^(organic|social|social[_ -]?organic|referral|bio|post|story|profile|email|sms|newsletter|influencer)$/i;
const DIRECT_TYPES = /^(direct|typein|type[_ -]?in|none|\(none\))$/i;
const SEARCH_TYPES = /^(seo|organic|search)$/i;

const clip = (s: string | undefined, n: number) => {
  const v = s?.trim();
  return v ? v.slice(0, n) : undefined;
};

function parseUrl(raw: string | undefined): URL | undefined {
  const s = raw?.trim();
  if (!s) return undefined;
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://x.invalid${s.startsWith("/") ? "" : "/"}${s}`);
  } catch {
    return undefined;
  }
}

/** The host without "www." and lower-cased, or undefined (and never our own placeholder host). */
function domainOf(raw: string | undefined): string | undefined {
  const u = parseUrl(raw);
  const host = u?.hostname.toLowerCase().replace(/^www\./, "");
  return host && host !== "x.invalid" ? host.slice(0, 253) : undefined;
}

function utmFrom(params: URLSearchParams | Record<string, string> | undefined): Utm {
  const get = (k: string) => (params instanceof URLSearchParams ? params.get(k) ?? undefined : params?.[k]);
  return {
    source: clip(get("utm_source"), 200), medium: clip(get("utm_medium"), 200), campaign: clip(get("utm_campaign"), 200),
    content: clip(get("utm_content"), 200), term: clip(get("utm_term"), 200), id: clip(get("utm_id"), 200),
  };
}

function clickIdFrom(params: URLSearchParams | Record<string, string> | undefined): OrderSource["clickId"] {
  if (!params) return undefined;
  const entries = params instanceof URLSearchParams ? [...params.entries()] : Object.entries(params);
  for (const kind of CLICK_ID_KINDS) {
    const hit = entries.find(([k]) => k.toLowerCase() === kind);
    const value = clip(hit?.[1], 500);
    if (value) return { kind, value };
  }
  return undefined;
}

const merge = (...all: Utm[]): Utm => {
  const out: Utm = {};
  for (const u of all) for (const [k, v] of Object.entries(u) as Array<[keyof Utm, string | undefined]>) if (v && !out[k]) out[k] = v;
  return out;
};
const hasUtm = (u: Utm) => Boolean(u.source || u.medium || u.campaign);

export function platformFromName(name: string | undefined): SourcePlatform | undefined {
  const n = name?.trim().toLowerCase().replace(/^l\.|^m\./, "");
  if (!n) return undefined;
  for (const [re, p] of PLATFORM_BY_NAME) if (re.test(n)) return p;
  const asDomain = PLATFORM_BY_DOMAIN.find(([re]) => re.test(n));
  return asDomain?.[1];
}

function platformFromDomain(domain: string | undefined): SourcePlatform | undefined {
  if (!domain) return undefined;
  for (const [re, p] of PLATFORM_BY_DOMAIN) if (re.test(domain)) return p;
  return undefined;
}

function paidFrom(medium: string | undefined, clickId: boolean): boolean | null {
  if (clickId) return true;
  if (medium && PAID_MEDIUM.test(medium)) return true;
  if (medium && ORGANIC_MEDIUM.test(medium)) return false;
  return null;
}

type Touch = Omit<OrderSource, "discountCodes" | "firstPlatform" | "firstSeenAt">;

/** One visit (or the order's own attributes) → a touch, by the ranked rules. undefined = nothing to go on. */
function resolveTouch(visit: SourceVisit | undefined, attributes: Record<string, string> | undefined, storeDomain?: string): Touch | undefined {
  const landing = parseUrl(visit?.landingUrl);
  const params = landing?.searchParams;
  const attrs = attributes && Object.fromEntries(Object.entries(attributes).map(([k, v]) => [k.toLowerCase(), v]));
  const utm = merge(utmFrom(params), visit?.utm ?? {}, utmFrom(attrs));
  const clickId = clickIdFrom(params) ?? clickIdFrom(attrs);
  const referrerDomain = domainOf(visit?.referrerUrl);
  const ownReferrer = Boolean(referrerDomain && storeDomain && (referrerDomain === storeDomain || referrerDomain.endsWith(`.${storeDomain}`)));
  const landingPath = landing ? clip(landing.pathname, 500) : undefined;
  const base = { utm, ...(clickId ? { clickId } : {}), ...(referrerDomain && !ownReferrer ? { referrerDomain } : {}), ...(landingPath ? { landingPath } : {}) };

  if (clickId) {
    // utm_source can still name the platform more precisely (a Google click id on a YouTube campaign is still google).
    return { ...base, platform: CLICK_ID_PLATFORM[clickId.kind], paid: true, rule: "click_id" };
  }
  if (hasUtm(utm)) {
    const platform = platformFromName(utm.source) ?? platformFromDomain(domainOf(utm.source)) ?? (utm.source ? "referral" : "unknown");
    return { ...base, platform, paid: paidFrom(utm.medium, false), rule: "utm" };
  }
  if (referrerDomain && !ownReferrer) {
    const platform = platformFromDomain(referrerDomain) ?? "referral";
    return { ...base, platform, paid: platform === "referral" ? false : null, rule: "referrer" };
  }
  const named = platformFromName(visit?.source);
  if (named) return { ...base, platform: named, paid: null, rule: "store" };
  if (visit?.sourceType && DIRECT_TYPES.test(visit.sourceType)) return { ...base, platform: "direct", paid: false, rule: "store" };
  if (visit?.sourceType && SEARCH_TYPES.test(visit.sourceType)) return { ...base, platform: "search", paid: false, rule: "store" };
  if (visit && (visit.landingUrl || visit.source || visit.sourceType)) return { ...base, platform: "direct", paid: false, rule: "store" };
  return undefined;
}

/** Sales channels that are not a website visit. */
function fromChannel(channel: string | undefined): Touch | undefined {
  const c = channel?.trim().toLowerCase();
  if (!c) return undefined;
  if (c === "pos" || c.includes("point_of_sale")) return { platform: "pos", paid: false, rule: "channel", utm: {} };
  if (/draft|admin|manual|phone|call/.test(c)) return { platform: "manual", paid: false, rule: "channel", utm: {} };
  if (/whatsapp/.test(c)) return { platform: "whatsapp", paid: null, rule: "channel", utm: {} };
  return undefined;
}

/**
 * The order's source from its hints. `storeDomain` (the shop's own host) keeps a store's internal
 * navigation from counting as a referral.
 */
export function resolveOrderSource(hints: OrderSourceHints | undefined, opts: { storeDomain?: string } = {}): OrderSource {
  const discountCodes = [...new Set((hints?.discountCodes ?? []).map((c) => c.trim()).filter(Boolean).map((c) => c.slice(0, 100)))].slice(0, 20);
  const channel = fromChannel(hints?.channel);
  const last = channel ?? resolveTouch(hints?.lastVisit, hints?.attributes, opts.storeDomain) ?? resolveTouch(hints?.firstVisit, undefined, opts.storeDomain);
  const first = hints?.firstVisit ? resolveTouch(hints.firstVisit, undefined, opts.storeDomain) : undefined;
  const touch: Touch = last ?? { platform: "unknown", paid: null, rule: "none", utm: {} };
  const firstSeenAt = hints?.firstVisit?.occurredAt;
  return {
    ...touch,
    discountCodes,
    ...(first && first.platform !== touch.platform ? { firstPlatform: first.platform } : {}),
    ...(firstSeenAt ? { firstSeenAt } : {}),
  };
}

/** Keep only attributes that can name a source: UTM tags and click ids (never names, phones or notes). */
export function sourceAttributes(pairs: Array<{ key?: unknown; value?: unknown }> | undefined): Record<string, string> | undefined {
  const keep: Record<string, string> = {};
  for (const p of pairs ?? []) {
    const k = typeof p.key === "string" ? p.key.trim().toLowerCase() : "";
    const v = typeof p.value === "string" ? p.value : typeof p.value === "number" ? String(p.value) : "";
    if (!k || !v) continue;
    if (/^utm_(source|medium|campaign|content|term|id)$/.test(k) || (CLICK_ID_KINDS as readonly string[]).includes(k)) keep[k] = v.slice(0, 500);
  }
  return Object.keys(keep).length ? keep : undefined;
}
