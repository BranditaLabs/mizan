import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const main = (await import(`../../messages/${locale}.json`)).default;
  // The public landing page keeps its copy in its own files (namespace "landing").
  const landing = (await import(`../../messages/landing/${locale}.json`)).default;
  return { locale, messages: { ...main, landing } };
});
