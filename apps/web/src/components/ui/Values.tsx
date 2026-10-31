"use client";

import type { Money } from "@mizan/shared";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { formatDate, formatMoney, formatRelative, type Digits } from "@/lib/format";
import { Bdi } from "../Bdi";
import { maskPhone } from "./logic";

/**
 * Money from a decimal string, isolated inside text of either direction ("1,150.00 ج.م." / "EGP 1,150.00").
 * `roll`: the scale settling (Mizan's signature motion): when the amount changes, the figure runs to
 * its new value and settles with a brief tint; `from` sets where it starts the first time (a KPI
 * counting up as the screen opens). Reduced motion shows the new value at once.
 */
export function MoneyText({ money, digits, roll = false, from }: { money: Money; digits?: Digits; roll?: boolean; from?: string }) {
  const locale = useLocale();
  if (!roll) return <Bdi>{formatMoney(money, locale, digits)}</Bdi>;
  return <RollingMoney money={money} digits={digits} locale={locale} from={from} />;
}

const ROLL_MS = 700;
const easeOut = (t: number) => 1 - Math.pow(2, -10 * t);

function RollingMoney({ money, digits, locale, from }: { money: Money; digits?: Digits; locale: string; from?: string }) {
  const target = Number(money.amount);
  const decimals = money.amount.split(".")[1]?.length ?? 0;
  const [shown, setShown] = useState(from === undefined ? target : Number(from));
  const [settled, setSettled] = useState(0);
  // What is on screen now: a roll interrupted (a new value, or an effect run twice) goes on from here.
  const onScreen = useRef(from === undefined ? target : Number(from));

  useEffect(() => {
    const start = onScreen.current;
    if (start === target || !Number.isFinite(target)) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const p = reduce ? 1 : Math.min(1, (now - t0) / ROLL_MS);
      const v = p < 1 ? start + (target - start) * easeOut(p) : target;
      onScreen.current = v;
      setShown(v);
      if (p < 1) raf = requestAnimationFrame(step);
      else setSettled((n) => n + 1);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  const text = formatMoney({ amount: shown.toFixed(decimals), currency: money.currency }, locale, digits);
  return <span key={settled} className={settled ? "mz-settle" : undefined}><Bdi>{text}</Bdi></span>;
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
