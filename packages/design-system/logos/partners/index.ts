/**
 * Partner logos (docs/16 §5.9): which mark to show for a provider, at what size, in which theme.
 * Framework-free; PartnerLogo (./react.tsx) renders the plan this returns.
 */
import { MARKS, PARTNERS, RASTERS, SIMPLE_ICONS_VERSION } from "./data";
import type { PartnerEntry, PartnerMark, PartnerRasterImage, PartnerVariant } from "./types";

export { MARKS, PARTNERS, RASTERS, SIMPLE_ICONS_VERSION };
export type { PartnerEntry, PartnerKind, PartnerMark, PartnerPermission, PartnerRaster, PartnerRasterImage, PartnerVariant } from "./types";

/** Where the apps serve the owner bitmaps (build-partners copies them to apps/{web,admin}/public/partners). */
export const PARTNER_ASSET_BASE = "/partners";

/** The three files of a bitmap face, for <img src srcSet>: width descriptors, so the browser picks by size and density. */
export const partnerRasterSrc = (img: PartnerRasterImage, base = PARTNER_ASSET_BASE) => ({
  src: `${base}/${img.file}@1x.png`,
  srcSet: img.widths.map((w, i) => `${base}/${img.file}@${i + 1}x.png ${w}w`).join(", "),
});

const BY_SLUG = new Map<string, PartnerEntry>();
for (const p of PARTNERS) {
  BY_SLUG.set(p.slug, p);
  for (const a of p.aliases ?? []) BY_SLUG.set(a, p);
}

/** The manifest entry for a slug or one of its aliases (whatsapp_cloud → whatsapp). */
export const partnerBySlug = (slug: string): PartnerEntry | undefined => BY_SLUG.get(slug.toLowerCase());

/** How one theme shows the mark: on a light neutral tile (colour), or bare (the brand's one-colour file). */
export type PartnerFace = { mark: PartnerMark; variant: PartnerVariant; tile: boolean };

/** A face of an owner bitmap (DS-3b): on the light neutral tile (marks), or bare (lockups). */
export type PartnerRasterFace = { image: PartnerRasterImage; tile: boolean };

export type PartnerLogoPlan =
  /**
   * hover: mono only, the colour mark on its tile shown on hover and focus (owner decision D8);
   * hoverRaster: the same from the owner's bitmap, preferred where one exists.
   */
  | { kind: "mark"; entry: PartnerEntry; name: string; light: PartnerFace; dark: PartnerFace; hover?: PartnerFace; hoverRaster?: PartnerRasterImage; markPx: number; padPx: number }
  /**
   * The owner's bitmap (DS-3b). shape "mark": a square of `width` with the image at imgW x imgH on
   * its light tile in both themes; "lockup": the whole logo, `height` tall, bare, with its dark face
   * (black parts turned white) on dark grounds.
   */
  | { kind: "raster"; entry: PartnerEntry; name: string; shape: PartnerLogoShape; light: PartnerRasterFace; dark: PartnerRasterFace; width: number; height: number; imgW: number; imgH: number; padPx: number }
  | { kind: "monogram"; entry: PartnerEntry | undefined; text: string; name: string }
  | { kind: "text"; entry: PartnerEntry; name: string };

/** "color" (default): full colour on a neutral tile, where recognition matters (owner decision D8). "mono": dense tables, chips and the landing. */
export type PartnerLogoVariant = "color" | "mono";

/** "mark" (default): the square icon. "lockup": icon and wordmark, where the owner's file has one; else the mark. */
export type PartnerLogoShape = "mark" | "lockup";

/** An id missing from the manifest is named by the caller's localized label; the raw id is the last resort. */
const nameOf = (entry: PartnerEntry | undefined, slug: string, locale: "ar" | "en", label?: string) =>
  entry ? (locale === "ar" ? entry.nameAr : entry.nameEn) : (label?.trim() || slug);
const latinInitial = (s: string) => s.replace(/[^A-Za-z0-9]/g, "").charAt(0).toUpperCase();
const initial = (entry: PartnerEntry | undefined, slug: string, label?: string) =>
  entry?.monogramText ?? (entry ? latinInitial(entry.nameEn) : (label?.trim().charAt(0) || latinInitial(slug)).toUpperCase());

/** The guide's written-permission demand is met: not asked for, or granted on a recorded date. */
export const partnerPermissionMet = (entry: PartnerEntry): boolean =>
  entry.permission === "not-required" || /^(granted|owner):\d{4}-\d{2}-\d{2}$/.test(entry.permission ?? "");

/**
 * The owner's bitmap at this size, or null when there is none, the permission is not met, or the
 * size is under its minimum. A lockup under its minimum width falls back to the mark.
 */
function rasterPlan(entry: PartnerEntry, name: string, size: number, shape: PartnerLogoShape): PartnerLogoPlan | null {
  const r = RASTERS[entry.slug];
  if (!r || entry.monogram || !partnerPermissionMet(entry)) return null;
  if (shape === "lockup" && r.lockup) {
    const img = r.lockup.light;
    const width = Math.round(size * img.w / img.h);
    if (width >= (r.lockupMinPx ?? r.minPx)) {
      return { kind: "raster", entry, name, shape, light: { image: img, tile: false }, dark: { image: r.lockup.dark ?? img, tile: false }, width, height: size, imgW: width, imgH: size, padPx: 0 };
    }
  }
  const clear = r.clearSpace ?? entry.clearSpace;
  const padPx = Math.round(size * clear / (1 + 2 * clear));
  const markPx = size - 2 * padPx;
  if (markPx < r.minPx) return null;
  // On its light tile in both themes, like every colour mark.
  const face = { image: r.mark.light, tile: true };
  return { kind: "raster", entry, name, shape: "mark", light: face, dark: face, width: size, height: size, imgW: markPx, imgH: markPx, padPx };
}

/**
 * Decides what PartnerLogo draws. A mark ships only when the entry has a guide link that someone
 * has read (guideCheckedAt), the written permission the guide asks for (permission), allowed
 * variants and a minimum size, and only if the mark (size minus clear space) is at least that
 * minimum; otherwise a monogram tile. Marks are never recoloured: "mono" picks the brand's own
 * black/white file only where allowedVariants lists it, else the colour mark on a light tile.
 * label names an id the manifest does not know (in the reader's language).
 */
export function planPartnerLogo(slug: string, size: number, variant: PartnerLogoVariant = "color", locale: "ar" | "en" = "en", label?: string, shape: PartnerLogoShape = "mark"): PartnerLogoPlan {
  const entry = partnerBySlug(slug);
  const name = nameOf(entry, slug, locale, label);
  if (entry?.textOnly) return { kind: "text", entry, name };
  const monogram = (): PartnerLogoPlan => ({ kind: "monogram", entry, text: initial(entry, slug, label), name });
  if (!entry) return monogram();
  // The owner's official bitmap (DS-3b) is the colour face wherever it exists.
  const raster = rasterPlan(entry, name, size, shape);
  if (raster && (variant === "color" || shape === "lockup")) return raster;

  const marks = MARKS[entry.slug];
  if (!marks || entry.monogram || !entry.guideUrl || !entry.guideCheckedAt || !partnerPermissionMet(entry) || entry.allowedVariants.length === 0 || !entry.minPx) return raster ?? monogram();
  const padPx = Math.round(size * entry.clearSpace / (1 + 2 * entry.clearSpace));
  const markPx = size - 2 * padPx;
  if (markPx < entry.minPx) return raster ?? monogram();

  const face = (v: PartnerVariant, tile: boolean): PartnerFace | null => (marks[v] ? { mark: marks[v]!, variant: v, tile } : null);
  // Colour always sits on a light neutral tile, in both themes: knockouts (Shopify's white S) stay true.
  const onTile = face("color", true) ?? face("black", true);
  if (!onTile) return raster ?? monogram(); // nothing that reads on a light page
  // Dark theme: the brand's negative file, otherwise the mark on its light tile.
  if (variant === "color") return { kind: "mark", entry, name, light: onTile, dark: face("on-dark", false) ?? onTile, markPx, padPx };
  const light = face("black", false) ?? onTile;
  const dark = face("on-dark", false) ?? face("white", false) ?? onTile;
  const oneColour = light !== onTile || dark !== onTile;
  // No one-colour file: the owner's colour bitmap reads better than a glyph on a tile.
  if (!oneColour && raster) return raster;
  // One colour at rest, the colour mark on its tile on hover and focus (D8): the owner's bitmap
  // where one exists, else the colour SVG.
  if (oneColour && raster?.kind === "raster") return { kind: "mark", entry, name, light, dark, hoverRaster: raster.light.image, markPx, padPx };
  const colour = face("color", true);
  const hover = colour && oneColour ? colour : undefined;
  return { kind: "mark", entry, name, light, dark, ...(hover ? { hover } : {}), markPx, padPx };
}

/**
 * The smallest outer size (clear space included) at which a partner's mark is drawn rather than
 * its monogram, or undefined when no size draws the mark (unchecked guide, no file, monogram).
 */
export function partnerMarkMinSize(slug: string): number | undefined {
  const entry = partnerBySlug(slug);
  if (!entry?.minPx) return undefined;
  const r = RASTERS[entry.slug];
  const start = Math.min(Math.ceil(entry.minPx * (1 + 2 * entry.clearSpace)), r ? Math.ceil(r.minPx * (1 + 2 * (r.clearSpace ?? entry.clearSpace))) : Infinity);
  for (let size = start; size <= start + 4; size++) if (["mark", "raster"].includes(planPartnerLogo(slug, size).kind)) return size;
  return undefined;
}
