/**
 * The marketing host (MARKETING_HOST, e.g. mizan.brandita.net) serves the public landing page at its
 * root: "/" and "/ar" "/en" are rewritten to "/{locale}/landing"; every other path is the app as usual.
 * Pure, so proxy.ts stays thin and the rule is unit tested.
 */
const LOCALES = ["ar", "en"] as const;
type Locale = (typeof LOCALES)[number];

/** "Mizan.Brandita.net:443" → "mizan.brandita.net". */
export const normalizeHost = (host: string | null | undefined): string => (host ?? "").split(",")[0]!.trim().toLowerCase().replace(/:\d+$/, "");

/** The first of ar/en in an Accept-Language header, by order of preference. */
function fromAcceptLanguage(header: string | null | undefined): Locale | undefined {
  const ranked = (header ?? "").split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.trim().slice(2) ?? 1);
      return { lang: tag!.trim().slice(0, 2).toLowerCase(), q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((x) => x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  return ranked.map((x) => x.lang).find((l): l is Locale => (LOCALES as readonly string[]).includes(l));
}

/**
 * The landing path to rewrite to, or null when the request is not for the landing page.
 * "/" picks the locale from the saved choice (cookie), then the browser, then Arabic.
 */
export function marketingRewrite(req: {
  host: string | null | undefined; marketingHost: string | undefined; pathname: string;
  cookieLocale?: string; acceptLanguage?: string | null;
}): string | null {
  const marketing = normalizeHost(req.marketingHost);
  if (!marketing || normalizeHost(req.host) !== marketing) return null;
  const m = /^\/(ar|en)\/?$/.exec(req.pathname);
  if (m) return `/${m[1]}/landing`;
  if (req.pathname !== "/") return null;
  const saved = (LOCALES as readonly string[]).includes(req.cookieLocale ?? "") ? (req.cookieLocale as Locale) : undefined;
  return `/${saved ?? fromAcceptLanguage(req.acceptLanguage) ?? "ar"}/landing`;
}
