"use client";

import { useTranslations } from "next-intl";
import type { Schemas } from "@/lib/api/client";
import { ProviderLogo } from "@/components/ui/PartnerLogo";

export type SourcePlatform = Schemas["OrderSources"]["byPlatform"][number]["platform"];

/** An order source's name in the page's language (Meta, تيك توك, "Direct visit"…), after its logo where it has one (DS-3b). */
export function PlatformName({ platform }: { platform: SourcePlatform }) {
  const t = useTranslations("sources.platform");
  return <span className="inline-flex items-center gap-1.5"><ProviderLogo slug={platform} />{t(platform)}</span>;
}
