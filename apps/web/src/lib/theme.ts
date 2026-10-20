/** Theme choice (docs/08 §2): explicit light/dark, or follow the system. Kept in a cookie so the server renders it without a flash. */
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_COOKIE = "mizan-theme";

export const parseTheme = (value: string | undefined): Theme => (THEMES as readonly string[]).includes(value ?? "") ? (value as Theme) : "system";

/** `<html data-theme>`: absent means "follow the system" (prefers-color-scheme in globals.css). */
export const themeAttribute = (theme: Theme): "light" | "dark" | undefined => (theme === "system" ? undefined : theme);

/** Browser only: apply a theme now and remember it for the next server render. */
export function applyTheme(theme: Theme, doc: Document = document): void {
  const attr = themeAttribute(theme);
  if (attr) doc.documentElement.dataset.theme = attr;
  else delete doc.documentElement.dataset.theme;
  doc.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
}
