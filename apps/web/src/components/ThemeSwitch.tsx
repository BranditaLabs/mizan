"use client";

import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import { useTranslations } from "next-intl";
import { chooseTheme, THEMES, type Theme } from "@/lib/theme";
import { useTheme } from "./ThemeProvider";
import { Segmented } from "./ui/Choice";

const ICON: Record<Theme, IconProps["name"]> = { light: "theme-light", dark: "theme-dark", system: "device" };

/** Light / dark / follow the system. Applied at once, remembered in a cookie for the server render. */
/** `initial` is kept for callers; the value comes from the one theme source (ThemeProvider). */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the prop stays for callers; ThemeProvider is the one source
export function ThemeSwitch(_: { initial?: Theme }) {
  const t = useTranslations("shell.theme");
  const theme = useTheme();
  return (
    <Segmented label={t("label")} value={theme}
      options={THEMES.map((th) => ({ value: th, label: <><Icon name={ICON[th]} size={14} />{t(th)}</> }))}
      onChange={chooseTheme} />
  );
}
