/**
 * <PartnerLogo slug="shopify" size={40} /> (docs/16 §5.9). Tailwind-free: styled by the .mz-partner
 * classes in css/components.css and the design tokens, so web, admin and the landing share it.
 *
 * - The mark is the brand's own path, never recoloured, cropped, rotated or animated (animate the tile).
 * - Colour sits on a light neutral tile in both themes; variant="mono" uses the brand's black/white
 *   file only where its guide allows it, and switches with the theme: the nearest data-theme wins,
 *   so a light island inside a dark page shows the light file. Where the brand has a colour file,
 *   mono shows it on its tile on hover and focus (owner decision D8); the mark itself never moves.
 * - The owner's official bitmaps (DS-3b: Shopify, Woo, Bosta, WhatsApp, Meta) render as <img> from
 *   /partners (assetBase) with 1x/2x/3x in srcSet, alt from the brand's name in the reader's language,
 *   decoding async; shape="lockup" draws icon and wordmark where the file has one (its dark face,
 *   black parts turned white, on dark grounds). next/image is not used: the package is framework-free.
 * - A brand without a usable mark, or a size under the guide's minimum, renders a monogram tile.
 * - Pass decorative when the brand's name is already written next to it (alt=""), else it is labelled.
 * - label names an id the manifest does not know, in the reader's language (never the raw id).
 */
import type { CSSProperties } from "react";
import { PARTNER_ASSET_BASE, partnerRasterSrc, planPartnerLogo, type PartnerFace, type PartnerLogoShape, type PartnerLogoVariant, type PartnerRasterImage } from "./index";

export interface PartnerLogoProps {
  slug: string;
  /** Outer size in px, clear space included. */
  size?: number;
  variant?: PartnerLogoVariant;
  /** "lockup": icon and wordmark at `size` tall, where the owner's file has one; else the square mark. */
  shape?: PartnerLogoShape;
  /** Where the bitmaps are served (default /partners). */
  assetBase?: string;
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

/** One bitmap face: the image (imgW x imgH) inside a box (width x height) with the clear space as padding. */
function RasterFace({ image, tile, scheme, box, img, padPx, alt, base }: { image: PartnerRasterImage; tile: boolean; scheme?: "light" | "dark" | "hover"; box: [number, number]; img: [number, number]; padPx: number; alt: string; base: string }) {
  const style: CSSProperties = { width: box[0], height: box[1], padding: padPx };
  const { src, srcSet } = partnerRasterSrc(image, base);
  return (
    <span className={tile ? "mz-partner-face mz-partner-tile" : "mz-partner-face"} data-scheme={scheme} data-variant="color" style={style}>
      <img src={src} srcSet={srcSet} sizes={`${img[0]}px`} width={img[0]} height={img[1]} alt={alt} decoding="async" loading="lazy" draggable={false} />
    </span>
  );
}

export function PartnerLogo({ slug, size = 32, variant = "color", shape = "mark", locale = "en", decorative = false, label, className, assetBase = PARTNER_ASSET_BASE }: PartnerLogoProps) {
  const plan = planPartnerLogo(slug, size, variant, locale, label, shape);
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
  if (plan.kind === "raster") {
    // The <img> carries the name (alt), so the wrapper has no role of its own; only the face that
    // shows is in the accessibility tree.
    const alt = decorative ? "" : plan.name;
    const dims = { box: [plan.width, plan.height] as [number, number], img: [plan.imgW, plan.imgH] as [number, number], padPx: plan.padPx, alt, base: assetBase };
    const one = plan.light.image === plan.dark.image;
    return (
      <span className={cls("mz-partner-mark")} data-slug={plan.entry.slug} data-shape={plan.shape} style={{ width: plan.width, height: plan.height }} {...(decorative ? { "aria-hidden": true } : {})}>
        {one
          ? <RasterFace {...plan.light} {...dims} />
          : <><RasterFace {...plan.light} scheme="light" {...dims} /><RasterFace {...plan.dark} scheme="dark" {...dims} /></>}
      </span>
    );
  }
  const same = plan.light === plan.dark;
  const dims = { markPx: plan.markPx, padPx: plan.padPx, size };
  return (
    <span className={cls("mz-partner-mark")} data-slug={plan.entry.slug} data-hover={plan.hover || plan.hoverRaster ? "" : undefined} style={{ width: size, height: size }} {...a11y}>
      {same
        ? <Face face={plan.light} {...dims} />
        : <><Face face={plan.light} scheme="light" {...dims} /><Face face={plan.dark} scheme="dark" {...dims} /></>}
      {plan.hoverRaster
        ? <RasterFace image={plan.hoverRaster} tile scheme="hover" box={[size, size]} img={[plan.markPx, plan.markPx]} padPx={plan.padPx} alt="" base={assetBase} />
        : plan.hover && <Face face={plan.hover} scheme="hover" {...dims} />}
    </span>
  );
}
