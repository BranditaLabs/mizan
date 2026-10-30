"use client";

import { useTranslations } from "next-intl";
import type { Schemas } from "@/lib/api/client";

export type SourcePlatform = Schemas["OrderSources"]["byPlatform"][number]["platform"];

/** An order source's name in the page's language (Meta, تيك توك, "Direct visit"…). */
export function PlatformName({ platform }: { platform: SourcePlatform }) {
  const t = useTranslations("sources.platform");
  return <span>{t(platform)}</span>;
}
