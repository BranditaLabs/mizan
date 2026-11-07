/**
 * <PartnerLogo slug="shopify" size={40} /> (docs/16 §5.9). Tailwind-free: styled by the .mz-partner
 * classes in css/components.css and the design tokens, so web, admin and the landing share it.
 *
 * - The mark is the brand's own path, never recoloured, cropped, rotated or animated (animate the tile).
 * - Colour sits on a light neutral tile in both themes; variant="mono" uses the brand's black/white
 *   file only where its guide allows it, and switches with the theme: the nearest data-theme wins,
 *   so a light island inside a dark page shows the light file. Where the brand has a colour file,
 *   mono shows it on its tile on hover and focus (owner decision D8); the mark itself never moves.
 * - A brand without a usable mark, or a size under the guide's minimum, renders a monogram tile.
 * - Pass decorative when the brand's name is already written next to it (alt=""), else it is labelled.
 * - label names an id the manifest does not know, in the reader's language (never the raw id).
 */
import type { CSSProperties } from "react";
import { planPartnerLogo, type PartnerFace, type PartnerLogoVariant } from "./index";

export interface PartnerLogoProps {
  slug: string;
  /** Outer size in px, clear space included. */
  size?: number;
  variant?: PartnerLogoVariant;
  locale?: "ar" | "en";
  /** The name is visible next to the logo: hide the logo from screen readers. */
  decorative?: boolean;
  /** The localized name for an id missing from the manifest; manifest entries use their own names. */
  label?: string;
  className?: string;
}

function Face({ face, scheme, markPx, padPx, size }: { face: PartnerFace; scheme?: "light" | "dark" | "hover"; markPx: number; padPx: number; size: number }) {
  const style: CSSProperties = { width: size, height: size, padding: padPx };
  return (
    <span className={face.tile ? "mz-partner-face mz-partner-tile" : "mz-partner-face"} data-scheme={scheme} data-variant={face.variant} style={style}>
      <svg viewBox={face.mark.viewBox} width={markPx} height={markPx} aria-hidden="true" focusable="false">
        {face.mark.paths.map((p, i) => <path key={i} d={p.d} fill={p.fill} />)}
      </svg>
    </span>
  );
}

export function PartnerLogo({ slug, size = 32, variant = "color", locale = "en", decorative = false, label, className }: PartnerLogoProps) {
  const plan = planPartnerLogo(slug, size, variant, locale, label);
  const a11y = decorative ? { "aria-hidden": true as const } : { role: "img" as const, "aria-label": plan.name };
  const cls = (extra: string) => ["mz-partner", extra, className].filter(Boolean).join(" ");

  if (plan.kind === "text") return <span className={cls("mz-partner-text")} {...(decorative ? { "aria-hidden": true } : {})}>{plan.name}</span>;
  if (plan.kind === "monogram") {
    const fontSize = Math.max(9, Math.round(size * (plan.text.length > 1 ? 0.34 : 0.44)));
    return (
      <span className={cls("mz-partner-monogram")} data-slug={slug} style={{ width: size, height: size, fontSize }} {...a11y}>
        <span aria-hidden="true">{plan.text}</span>
      </span>
    );
  }
  const same = plan.light === plan.dark;
  const dims = { markPx: plan.markPx, padPx: plan.padPx, size };
  return (
    <span className={cls("mz-partner-mark")} data-slug={plan.entry.slug} data-hover={plan.hover ? "" : undefined} style={{ width: size, height: size }} {...a11y}>
      {same
        ? <Face face={plan.light} {...dims} />
        : <><Face face={plan.light} scheme="light" {...dims} /><Face face={plan.dark} scheme="dark" {...dims} /></>}
      {plan.hover && <Face face={plan.hover} scheme="hover" {...dims} />}
    </span>
  );
}
