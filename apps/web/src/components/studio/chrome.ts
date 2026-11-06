import { getTranslations } from "next-intl/server";
import type { PhoneChrome } from "./WhatsAppPhone";

const KEYS = ["today", "business", "typing", "message", "send", "notice", "customer", "calling"] as const satisfies ReadonlyArray<keyof PhoneChrome>;

/**
 * WhatsApp's own words in each buyer language (messages: whatsappPhone.chrome), read on the server
 * from both language files: the phone speaks the buyer's language whatever the dashboard's is.
 */
export async function phoneChrome(): Promise<Record<"ar" | "en", PhoneChrome>> {
  const read = async (locale: "ar" | "en") => {
    const t = await getTranslations({ locale, namespace: "whatsappPhone.chrome" });
    return Object.fromEntries(KEYS.map((k) => [k, t(k)])) as unknown as PhoneChrome;
  };
  const [ar, en] = await Promise.all([read("ar"), read("en")]);
  return { ar, en };
}
