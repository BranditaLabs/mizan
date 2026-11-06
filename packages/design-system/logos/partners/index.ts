/**
 * Partner logos (docs/16 §5.9): which mark to show for a provider, at what size, in which theme.
 * Framework-free; PartnerLogo (./react.tsx) renders the plan this returns.
 */
import { MARKS, PARTNERS, SIMPLE_ICONS_VERSION } from "./data";
import type { PartnerEntry, PartnerMark, PartnerVariant } from "./types";

export { MARKS, PARTNERS, SIMPLE_ICONS_VERSION };
export type { PartnerEntry, PartnerKind, PartnerMark, PartnerVariant } from "./types";

const BY_SLUG = new Map<string, PartnerEntry>();
for (const p of PARTNERS) {
  BY_SLUG.set(p.slug, p);
  for (const a of p.aliases ?? []) BY_SLUG.set(a, p);
}

/** The manifest entry for a slug or one of its aliases (whatsapp_cloud → whatsapp). */
export const partnerBySlug = (slug: string): PartnerEntry | undefined => BY_SLUG.get(slug.toLowerCase());

/** How one theme shows the mark: on a light neutral tile (colour), or bare (the brand's one-colour file). */
export type PartnerFace = { mark: PartnerMark; variant: PartnerVariant; tile: boolean };

export type PartnerLogoPlan =
  | { kind: "mark"; entry: PartnerEntry; name: string; light: PartnerFace; dark: PartnerFace; markPx: number; padPx: number }
  | { kind: "monogram"; entry: PartnerEntry | undefined; text: string; name: string }
  | { kind: "text"; entry: PartnerEntry; name: string };

/** "color" (default): full colour on a neutral tile, where recognition matters (owner decision D8). "mono": dense tables, chips and the landing. */
export type PartnerLogoVariant = "color" | "mono";

const nameOf = (entry: PartnerEntry | undefined, slug: string, locale: "ar" | "en") => entry ? (locale === "ar" ? entry.nameAr : entry.nameEn) : slug;
const initial = (entry: PartnerEntry | undefined, slug: string) => entry?.monogramText ?? (entry?.nameEn ?? slug).replace(/[^A-Za-z0-9]/g, "").charAt(0).toUpperCase();

/**
 * Decides what PartnerLogo draws. A mark ships only when the entry has a guide link that someone
 * has read (guideCheckedAt), allowed variants and a minimum size, and only if the mark (size minus clear space) is at least that
 * minimum; otherwise a monogram tile. Marks are never recoloured: "mono" picks the brand's own
 * black/white file only where allowedVariants lists it, else the colour mark on a light tile.
 */
export function planPartnerLogo(slug: string, size: number, variant: PartnerLogoVariant = "color", locale: "ar" | "en" = "en"): PartnerLogoPlan {
  const entry = partnerBySlug(slug);
  const name = nameOf(entry, slug, locale);
  if (entry?.textOnly) return { kind: "text", entry, name };
  const monogram = (): PartnerLogoPlan => ({ kind: "monogram", entry, text: initial(entry, slug), name });
  const marks = entry ? MARKS[entry.slug] : undefined;
  if (!entry || entry.monogram || !marks || !entry.guideUrl || !entry.guideCheckedAt || entry.allowedVariants.length === 0 || !entry.minPx) return monogram();

  const padPx = Math.round(size * entry.clearSpace / (1 + 2 * entry.clearSpace));
  const markPx = size - 2 * padPx;
  if (markPx < entry.minPx) return monogram();

  const face = (v: PartnerVariant, tile: boolean): PartnerFace | null => (marks[v] ? { mark: marks[v]!, variant: v, tile } : null);
  // Colour always sits on a light neutral tile, in both themes: knockouts (Shopify's white S) stay true.
  const onTile = face("color", true) ?? face("black", true);
  if (!onTile) return monogram(); // nothing that reads on a light page
  // Dark theme: the brand's negative file, otherwise the mark on its light tile.
  if (variant === "color") return { kind: "mark", entry, name, light: onTile, dark: face("on-dark", false) ?? onTile, markPx, padPx };
  const light = face("black", false) ?? onTile;
  const dark = face("on-dark", false) ?? face("white", false) ?? onTile;
  return { kind: "mark", entry, name, light, dark, markPx, padPx };
}

/**
 * The smallest outer size (clear space included) at which a partner's mark is drawn rather than
 * its monogram, or undefined when no size draws the mark (unchecked guide, no file, monogram).
 */
export function partnerMarkMinSize(slug: string): number | undefined {
  const entry = partnerBySlug(slug);
  if (!entry?.minPx) return undefined;
  const start = Math.ceil(entry.minPx * (1 + 2 * entry.clearSpace));
  for (let size = start; size <= start + 4; size++) if (planPartnerLogo(slug, size).kind === "mark") return size;
  return undefined;
}
