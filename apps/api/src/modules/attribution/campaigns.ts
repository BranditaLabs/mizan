import type { SourcePlatform } from "@mizan/shared";
import type { AdPlatform } from "../profit/ads/ad-spend.csv.js";

/**
 * Campaign results (M7-3): which recorded spend bought which orders, by the orders' UTM tags.
 *
 * Spend comes per platform, campaign, ad set and ad (a CSV export, later the APIs); orders carry
 * utm_id / utm_campaign, utm_term and utm_content (M7-2). Ad platforms' URL templates put either ids
 * or names there, so a tag matches a spend row's id or its name, ignoring case and spacing:
 *   campaign ← utm_id or utm_campaign · ad set ← utm_term · ad ← utm_content
 * on the same platform (spend under "other" takes orders from platforms without their own code).
 * Orders tagged with a campaign that has no spend keep their own row (spend unknown); orders without
 * the level's tag and spend without the level's key are totalled apart, so nothing is hidden.
 */
export type Level = "campaign" | "adset" | "ad";
export const LEVELS = ["campaign", "adset", "ad"] as const satisfies readonly Level[];

export interface Measures { orders: bigint; delivered: bigint; lost: bigint; cancelled: bigint; placed: bigint; real: bigint; net: bigint }
export interface SpendEntity { platform: AdPlatform; campaign: string; campaignName: string; adset: string; adsetName: string; ad: string; adName: string; minor: bigint }
export interface OrderGroup {
  platform: SourcePlatform; utmId: string | null; utmCampaign: string | null; utmTerm: string | null; utmContent: string | null; m: Measures;
}
export interface Named { key: string; name: string }
export interface CampaignRow { platform: SourcePlatform | AdPlatform; campaign: Named; adset: Named | null; ad: Named | null; spend: bigint | null; m: Measures }

const AD_CODES: ReadonlySet<string> = new Set(["meta", "tiktok", "google", "snapchat"]);
export const zero = (): Measures => ({ orders: 0n, delivered: 0n, lost: 0n, cancelled: 0n, placed: 0n, real: 0n, net: 0n });
const add = (a: Measures, b: Measures) => { for (const k of Object.keys(a) as Array<keyof Measures>) a[k] += b[k]; };

/** A tag or a name as compared: Unicode-normalised, lower case, inner spaces collapsed. */
export const norm = (s: string | null | undefined) => (s ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
const idents = (...v: string[]) => new Set(v.map(norm).filter(Boolean));
const meets = (a: Set<string>, b: Set<string>) => [...a].some((x) => b.has(x));
const samePlatform = (spend: AdPlatform, order: SourcePlatform) => spend === order || (spend === "other" && !AD_CODES.has(order));

export function campaignResults(level: Level, spend: SpendEntity[], orders: OrderGroup[]) {
  const deep = level !== "campaign";
  const deepest = level === "ad";
  // Spend at this level; a row without the level's key (a day's total, a file without ad sets) stays apart.
  const groups = new Map<string, CampaignRow & { ids: { campaign: Set<string>; adset: Set<string>; ad: Set<string> } }>();
  let unassignedSpend = 0n;
  for (const s of spend) {
    if (!s.campaign || (deep && !s.adset) || (deepest && !s.ad)) { unassignedSpend += s.minor; continue; }
    const k = [s.platform, s.campaign, deep ? s.adset : "", deepest ? s.ad : ""].join("\u0000");
    const g = groups.get(k) ?? {
      platform: s.platform, campaign: { key: s.campaign, name: s.campaignName || s.campaign },
      adset: deep ? { key: s.adset, name: s.adsetName || s.adset } : null, ad: deepest ? { key: s.ad, name: s.adName || s.ad } : null,
      spend: 0n, m: zero(), ids: { campaign: idents(s.campaign, s.campaignName), adset: idents(s.adset, s.adsetName), ad: idents(s.ad, s.adName) },
    };
    g.spend! += s.minor;
    groups.set(k, g);
  }
  const spent = [...groups.values()].sort((a, b) => (b.spend! > a.spend! ? 1 : b.spend! < a.spend! ? -1 : 0));

  // Orders: to the biggest matching spend, else their own row by tag; untagged ones are totalled.
  const own = new Map<string, CampaignRow>();
  const untagged = zero();
  for (const o of orders) {
    const tags = idents(o.utmId ?? "", o.utmCampaign ?? "");
    const term = norm(o.utmTerm);
    const content = norm(o.utmContent);
    if (!tags.size || (deep && !term) || (deepest && !content)) { add(untagged, o.m); continue; }
    const hit = spent.find((g) => samePlatform(g.platform as AdPlatform, o.platform) && meets(tags, g.ids.campaign)
      && (!deep || g.ids.adset.has(term)) && (!deepest || g.ids.ad.has(content)));
    if (hit) { add(hit.m, o.m); continue; }
    const name = (o.utmCampaign ?? o.utmId)!.trim();
    const k = [o.platform, norm(name), deep ? term : "", deepest ? content : ""].join("\u0000");
    const row = own.get(k) ?? {
      platform: o.platform, campaign: { key: name, name }, spend: null, m: zero(),
      adset: deep ? { key: o.utmTerm!.trim(), name: o.utmTerm!.trim() } : null, ad: deepest ? { key: o.utmContent!.trim(), name: o.utmContent!.trim() } : null,
    };
    add(row.m, o.m);
    own.set(k, row);
  }
  const rows: CampaignRow[] = [
    ...spent.map(({ ids: _ids, ...r }) => r),
    ...[...own.values()].sort((a, b) => (b.m.orders > a.m.orders ? 1 : b.m.orders < a.m.orders ? -1 : a.campaign.name.localeCompare(b.campaign.name))),
  ];
  return { rows, untagged, unassignedSpend };
}
