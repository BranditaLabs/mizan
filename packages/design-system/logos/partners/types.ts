/** Partner logo manifest types (docs/16 §5.9). */
export type PartnerVariant = "color" | "black" | "white" | "on-dark";
export type PartnerKind = "store" | "marketplace" | "courier" | "payment" | "messaging" | "ads" | "government";

export interface PartnerEntry {
  slug: string;
  kind: PartnerKind;
  nameEn: string;
  nameAr: string;
  /** "simple-icons@<exact version>", "press-kit", "owner-supplied <YYYY-MM-DD>" or "monogram" */
  source: string;
  guideUrl: string | null;
  allowedVariants: PartnerVariant[];
  /** Smallest size of the mark itself (without its clear space), from the brand's guide. */
  minPx: number;
  /** Clear space on every side, as a share of the mark's size. */
  clearSpace: number;
  hasDark: boolean;
  /** No usable mark: a neutral tile with the initial. */
  monogram: boolean;
  monogramText?: string;
  /** Shown as its name in text only (e.g. ZATCA until it approves its mark). */
  textOnly?: boolean;
  /** Provider ids used elsewhere in Mizan that mean this brand (whatsapp_cloud → whatsapp). */
  aliases?: string[];
  /** When someone read the guide and confirmed variants, size and clear space; null = unconfirmed. */
  guideCheckedAt: string | null;
  /**
   * Whether the brand's guide asks for written permission: "not-required", "granted:<YYYY-MM-DD>"
   * (the written OK is on file) or "required" (asked for, not granted yet). Only not-required or
   * granted draws a mark; "required" or a missing value renders the monogram.
   */
  permission?: PartnerPermission;
  /** Where the owner's bitmap logo came from ("owner-supplied <YYYY-MM-DD>"), when it has one (RASTERS). */
  rasterSource?: string;
}

/**
 * "owner:<YYYY-MM-DD>": the owner supplied the brand's official logo and decided to show it (DS-3b);
 * the brand's own written OK, when it arrives, is recorded as "granted:<date>".
 */
export type PartnerPermission = "not-required" | "required" | `granted:${string}` | `owner:${string}`;

/** One face of an owner bitmap: <file>@1x.png, @2x, @3x; w and h at 1x, widths of the three files. */
export interface PartnerRasterImage {
  file: string;
  w: number;
  h: number;
  widths: number[];
}

/** An owner-supplied bitmap logo (DS-3b): a square mark and, where one exists, a wide lockup. */
export interface PartnerRaster {
  /** Smallest mark (without clear space) drawn, in px. */
  minPx: number;
  /** Smallest lockup width drawn, in px, where the brand's guide gives one. */
  lockupMinPx?: number;
  /** Clear space around the mark on its tile, where it differs from the entry's (a share of the mark's size). */
  clearSpace?: number;
  /** dark: a face for dark grounds where the logo has black parts (a wordmark turned white). */
  mark: { light: PartnerRasterImage; dark?: PartnerRasterImage };
  lockup?: { light: PartnerRasterImage; dark?: PartnerRasterImage };
}

export interface PartnerMark {
  viewBox: string;
  paths: Array<{ d: string; fill: string }>;
}
