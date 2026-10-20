"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { SegmentButton, Segmented } from "./Segmented";

/** عربي / English: same page in the other language; next-intl stores the choice in a cookie. */
export function LocaleSwitch() {
  const t = useTranslations("shell.language");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <Icon name="language" size={16} className="text-text-3" />
      <Segmented label={t("label")}>
        {routing.locales.map((l: Locale) => (
          <SegmentButton key={l} lang={l} pressed={l === locale} disabled={pending}
            onClick={() => startTransition(() => router.replace(pathname, { locale: l }))}>
            {t(l)}
          </SegmentButton>
        ))}
      </Segmented>
    </div>
  );
}
