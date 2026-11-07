"use client";

import { PROVIDER_CATALOG, STORE_COURIER } from "@mizan/shared";
import { useLocale, useTranslations } from "next-intl";
import { useCallback } from "react";

const BY_SLUG = new Map<string, (typeof PROVIDER_CATALOG)[number]>(PROVIDER_CATALOG.map((p) => [p.slug, p]));

/**
 * A provider's or courier's name for the screen (X9, FX-1), from the shared catalogue in the
 * reader's language; the store's own courier code ("store_courier") translated; any other name (a
 * courier typed by hand) as it was typed. One helper instead of three `providerName` copies.
 */
export function useProviderName(): (slugOrName: string) => string {
  const locale = useLocale();
  const t = useTranslations("providerNames");
  return useCallback((s: string) => {
    if (s === STORE_COURIER) return t("store_courier");
    const p = BY_SLUG.get(s);
    if (p) return locale === "ar" ? p.nameAr : p.nameEn;
    return s;
  }, [locale, t]);
}
