"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { applyTheme, THEMES, type Theme } from "@/lib/theme";

/** Light / dark / follow the system. Applied at once, remembered in a cookie for the server render. */
export function ThemeSwitch({ initial }: { initial: Theme }) {
  const t = useTranslations("shell.theme");
  const [theme, setTheme] = useState(initial);
  const choose = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
  };
  return (
    <div role="group" aria-label={t("label")} className="inline-flex gap-0.5 rounded-[9px] border border-line bg-surface p-[3px]">
      {THEMES.map((th) => (
        <button key={th} type="button" aria-pressed={th === theme} onClick={() => choose(th)}
          className={`rounded-[6px] px-[11px] py-[5px] text-[12.5px] font-semibold ${th === theme ? "bg-ink text-bg" : "text-ink-2 hover:bg-surface-2"}`}>
          {t(th)}
        </button>
      ))}
    </div>
  );
}
