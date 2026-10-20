"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { Segmented } from "./ui/Choice";

/** عربي / English: same page in the other language; next-intl stores the choice in a cookie. */
export function LocaleSwitch() {
  const t = useTranslations("shell.language");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-2" aria-busy={pending || undefined}>
      <Icon name="language" size={16} className="text-text-3" />
      <Segmented label={t("label")} value={locale}
        options={routing.locales.map((l) => ({ value: l, label: t(l), lang: l }))}
        onChange={(l) => startTransition(() => router.replace(pathname, { locale: l }))} />
    </div>
  );
}
