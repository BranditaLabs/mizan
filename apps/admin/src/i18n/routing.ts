import { defineRouting } from "next-intl/routing";

/** Arabic first, like the dashboard (docs/08 §3). */
export const routing = defineRouting({
  locales: ["ar", "en"],
  defaultLocale: "ar",
  localePrefix: "always",
  localeCookie: { name: "mizan-admin-locale", maxAge: 60 * 60 * 24 * 365 },
});

export type Locale = (typeof routing.locales)[number];

export const dirOf = (locale: Locale): "rtl" | "ltr" => (locale === "ar" ? "rtl" : "ltr");
