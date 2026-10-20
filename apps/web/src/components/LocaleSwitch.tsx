"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";

/** عربي / English: same page in the other language; next-intl stores the choice in a cookie. */
export function LocaleSwitch() {
  const t = useTranslations("shell.language");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  return (
    <div role="group" aria-label={t("label")} className="inline-flex gap-0.5 rounded-[9px] border border-line bg-surface p-[3px]">
      {routing.locales.map((l: Locale) => (
        <button key={l} type="button" lang={l} aria-pressed={l === locale} disabled={pending}
          onClick={() => startTransition(() => router.replace(pathname, { locale: l }))}
          className={`rounded-[6px] px-[11px] py-[5px] text-[12.5px] font-semibold ${l === locale ? "bg-ink text-bg" : "text-ink-2 hover:bg-surface-2"}`}>
          {t(l)}
        </button>
      ))}
    </div>
  );
}
