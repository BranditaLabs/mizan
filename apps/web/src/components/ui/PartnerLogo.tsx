"use client";

import { useLocale } from "next-intl";
import { PartnerLogo as Logo, type PartnerLogoProps } from "@mizan/design-system/partners/react";

/**
 * A provider's real logo (docs/16 §5.9): the design system's PartnerLogo with the reader's language
 * for its label. Moves to packages/ui (brand/) in DS-4a; this path stays as a re-export.
 */
export function PartnerLogo(props: Omit<PartnerLogoProps, "locale">) {
  const locale = useLocale() === "ar" ? "ar" : "en";
  return <Logo {...props} locale={locale} />;
}
