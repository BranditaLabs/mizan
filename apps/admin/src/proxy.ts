import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

/** Locale negotiation: cookie → Accept-Language → Arabic; every page lives under /ar or /en. */
export default createMiddleware(routing);

export const config = { matcher: ["/((?!_next|_vercel|.*\\..*).*)"] };
