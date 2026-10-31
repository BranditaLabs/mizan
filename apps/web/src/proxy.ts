import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { marketingRewrite } from "./lib/marketing";

/** Locale negotiation: cookie → Accept-Language → Arabic; every page lives under /ar or /en. */
const intl = createMiddleware(routing);

/**
 * On the marketing host (MARKETING_HOST, e.g. mizan.brandita.net) "/", "/ar" and "/en" show the
 * public landing page (/{locale}/landing) without changing the address; everything else is unchanged.
 */
export default function proxy(req: NextRequest) {
  const target = marketingRewrite({
    host: req.headers.get("x-forwarded-host") ?? req.headers.get("host"),
    marketingHost: process.env.MARKETING_HOST,
    pathname: req.nextUrl.pathname,
    cookieLocale: req.cookies.get((routing.localeCookie as { name: string }).name)?.value,
    acceptLanguage: req.headers.get("accept-language"),
  });
  if (target) {
    const url = req.nextUrl.clone();
    url.pathname = target;
    return NextResponse.rewrite(url);
  }
  return intl(req);
}

export const config = { matcher: ["/((?!_next|_vercel|.*\\..*).*)"] };
