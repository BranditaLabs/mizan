/** Partner logo manifest types (docs/16 §5.9). */
export type PartnerVariant = "color" | "black" | "white" | "on-dark";
export type PartnerKind = "store" | "marketplace" | "courier" | "payment" | "messaging" | "ads" | "government";

export interface PartnerEntry {
  slug: string;
  kind: PartnerKind;
  nameEn: string;
  nameAr: string;
  /** "simple-icons@<exact version>", "press-kit" or "monogram" */
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
}

export interface PartnerMark {
  viewBox: string;
  paths: Array<{ d: string; fill: string }>;
}
