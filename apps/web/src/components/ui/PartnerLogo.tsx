"use client";

import { useLocale } from "next-intl";
import { partnerBySlug } from "@mizan/design-system/partners";
import { PartnerLogo as Logo, type PartnerLogoProps } from "@mizan/design-system/partners/react";

/**
 * A provider's real logo (docs/16 §5.9): the design system's PartnerLogo with the reader's language
 * for its label. Moves to packages/ui (brand/) in DS-4a; this path stays as a re-export.
 */
export function PartnerLogo(props: Omit<PartnerLogoProps, "locale">) {
  const locale = useLocale() === "ar" ? "ar" : "en";
  return <Logo {...props} locale={locale} />;
}

/**
 * The logo next to a provider's written name (DS-3b): decorative, since the name is beside it, and
 * nothing at all for a name the manifest does not know (a courier typed by hand, "manual").
 */
export function ProviderLogo({ slug, size = 24, variant, shape, className }: { slug: string | null | undefined } & Pick<PartnerLogoProps, "size" | "variant" | "shape" | "className">) {
  if (!slug || !partnerBySlug(slug) || slug === "manual" || slug === "other") return null;
  return <PartnerLogo slug={slug} size={size} decorative {...(variant ? { variant } : {})} {...(shape ? { shape } : {})} {...(className ? { className } : {})} />;
}
