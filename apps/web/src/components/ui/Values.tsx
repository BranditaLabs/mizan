"use client";

import type { Money } from "@mizan/shared";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { formatDate, formatMoney, formatRelative, type Digits } from "@/lib/format";
import { Bdi } from "../Bdi";
import { maskPhone } from "./logic";

/** Money from a decimal string, isolated inside text of either direction ("1,150.00 ج.م." / "EGP 1,150.00"). */
export function MoneyText({ money, digits }: { money: Money; digits?: Digits }) {
  const locale = useLocale();
  return <Bdi>{formatMoney(money, locale, digits)}</Bdi>;
}

/**
 * A customer's phone: masked by default (personal data, docs/07); `onReveal` lets the caller log the
 * access (audit) before the full number shows. Always left to right, in mono.
 */
export function PhoneText({ e164, revealable = false, onReveal }: { e164: string; revealable?: boolean; onReveal?(): void }) {
  const t = useTranslations("ui.phone");
  const [shown, setShown] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <Bdi code>{shown ? e164 : maskPhone(e164)}</Bdi>
      {revealable && !shown ? (
        <button type="button" className="text-caption text-text-2 underline underline-offset-2 hover:text-text" onClick={() => { onReveal?.(); setShown(true); }}>
          {t("reveal")}
        </button>
      ) : null}
    </span>
  );
}

/** A moment: relative ("منذ ٦ دقائق") or a date, with the exact time in `dateTime` and on hover. */
export function DateText({ value, relative = false, now }: { value: Date | string; relative?: boolean; now?: number }) {
  const locale = useLocale();
  const d = new Date(value);
  const exact = new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-EG", { dateStyle: "medium", timeStyle: "short", numberingSystem: "latn", timeZone: "Africa/Cairo" }).format(d);
  return <time dateTime={d.toISOString()} title={exact} suppressHydrationWarning>{relative ? formatRelative(d, locale, now) : formatDate(d, locale)}</time>;
}
