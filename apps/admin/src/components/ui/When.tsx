"use client";

import { useLocale } from "next-intl";
import { formatDate } from "@/lib/format";

/** A date in the page's language, with the exact time on hover (Cairo time, Western digits). */
export function When({ value, time = false }: { value: string; time?: boolean }) {
  const locale = useLocale();
  const d = new Date(value);
  const exact = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-EG", { dateStyle: "medium", timeStyle: "short", numberingSystem: "latn", timeZone: "Africa/Cairo" }).format(d);
  return <time dateTime={d.toISOString()} title={exact} suppressHydrationWarning>{time ? exact : formatDate(d, locale)}</time>;
}
