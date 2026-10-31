/**
 * Where the landing page's calls to action go. The landing page may be served from the marketing host
 * (MARKETING_HOST, proxy.ts) while the dashboard lives on NEXT_PUBLIC_APP_URL; without it the links
 * stay on this host.
 */
const app = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");

export const signUpHref = (locale: string) => `${app}/${locale}/sign-in?mode=signup`;
export const signInHref = (locale: string) => `${app}/${locale}/sign-in`;
export const legalHref = (locale: string, doc: "privacy" | "terms" | "dpa") => `/${locale}/legal/${doc}`;

// [CONFIRM] the demo/contact address (NEXT_PUBLIC_DEMO_URL, e.g. a booking page, wins when set).
export const demoHref = process.env.NEXT_PUBLIC_DEMO_URL || "mailto:hello@brandita.net";
// [CONFIRM] the partners address.
export const partnersHref = "mailto:hello@brandita.net?subject=Mizan%20partners";
export const branditaHref = "https://brandita.net";
