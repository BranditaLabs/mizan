"use client";

import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { applyTheme, THEMES, type Theme } from "@/lib/theme";
import { SegmentButton, Segmented } from "./Segmented";

const ICON: Record<Theme, IconProps["name"]> = { light: "theme-light", dark: "theme-dark", system: "device" };

/** Light / dark / follow the system. Applied at once, remembered in a cookie for the server render. */
export function ThemeSwitch({ initial }: { initial: Theme }) {
  const t = useTranslations("shell.theme");
  const [theme, setTheme] = useState(initial);
  return (
    <Segmented label={t("label")}>
      {THEMES.map((th) => (
        <SegmentButton key={th} pressed={th === theme} onClick={() => { setTheme(th); applyTheme(th); }}>
          <Icon name={ICON[th]} size={14} />
          {t(th)}
        </SegmentButton>
      ))}
    </Segmented>
  );
}
