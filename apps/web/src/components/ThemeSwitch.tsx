"use client";

import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { chooseTheme, currentTheme, subscribeTheme, THEMES, type Theme } from "@/lib/theme";
import { Segmented } from "./ui/Choice";

const ICON: Record<Theme, IconProps["name"]> = { light: "theme-light", dark: "theme-dark", system: "device" };

/** Light / dark / follow the system. Applied at once, remembered in a cookie for the server render. */
export function ThemeSwitch({ initial }: { initial: Theme }) {
  const t = useTranslations("shell.theme");
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => initial);
  return (
    <Segmented label={t("label")} value={theme}
      options={THEMES.map((th) => ({ value: th, label: <><Icon name={ICON[th]} size={14} />{t(th)}</> }))}
      onChange={chooseTheme} />
  );
}
