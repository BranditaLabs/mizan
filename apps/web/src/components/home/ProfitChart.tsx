"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { MoneyText } from "@/components/ui/Values";
import type { Schemas } from "@/lib/api/client";

type Home = Schemas["ProfitHome"];
const H = 224;
const PAD = 10;
const minor = (m: { amount: string }) => Math.round(Number(m.amount) * 100);
const noon = (day: string) => new Date(`${day}T12:00:00Z`);

/**
 * Profit per day (M5): what each day's orders make if those on their way deliver (the area, rising),
 * and what is already real (the line, drawing itself). The zero line sits where it falls; loss days
 * are marked in red. A crosshair follows the pointer or the keyboard with the day's figures.
 * Time runs left to right in both languages (charts are not mirrored).
 */
export function ProfitChart({ home }: { home: Home }) {
  const t = useTranslations("profitHome.trend");
  const locale = useLocale();
  const [at, setAt] = useState<number | null>(null);
  // Drawn at its real width (no stretched viewBox): lines keep their weight and draw evenly.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const days = home.trend;
  const expected = days.map((d) => minor(d.expectedNet));
  const real = days.map((d) => minor(d.net));
  const top = Math.max(1, ...expected, ...real);
  const bottom = Math.min(0, ...expected, ...real);
  const y = (v: number) => PAD + (H - 2 * PAD) * (1 - (v - bottom) / (top - bottom));
  const x = (i: number) => (days.length <= 1 ? W / 2 : (i / (days.length - 1)) * W);
  const zero = y(0);
  const line = (vals: number[]) => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)} ${y(v).toFixed(2)}`).join(" ");
  const area = `${line(expected)} L${x(days.length - 1).toFixed(2)} ${zero.toFixed(2)} L${x(0).toFixed(2)} ${zero.toFixed(2)} Z`;
  const fmtDay = (d: string) => new Intl.DateTimeFormat(locale === "ar" ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(noon(d));
  const tip = at !== null ? days[at] : undefined;
  const total = days.reduce((a, d) => a + minor(d.expectedNet), 0);
  const avg = days.length ? total / days.length : 0;

  const pick = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const i = Math.round(((clientX - r.left) / r.width) * (days.length - 1));
    setAt(Math.max(0, Math.min(days.length - 1, i)));
  };

  return (
    <section className="mz-card flex flex-col gap-4 p-5 lg:col-span-2" aria-labelledby="trend-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="trend-title" className="text-heading-sm">{t("title")}</h2>
          <p className="text-caption text-text-3">{t("hint")}</p>
        </div>
        <ul className="flex items-center gap-4 text-caption text-text-2" aria-hidden="true">
          <li className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-xs bg-text-3 opacity-40" />{t("expected")}</li>
          <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded-full bg-text" />{t("real")}</li>
        </ul>
      </div>

      <div ref={box} className="relative" dir="ltr" tabIndex={0} role="group" aria-label={t("explore")}
        onMouseMove={(e) => pick(e.clientX, e.currentTarget)} onMouseLeave={() => setAt(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") setAt((i) => Math.min(days.length - 1, (i ?? -1) + 1));
          else if (e.key === "ArrowLeft") setAt((i) => Math.max(0, (i ?? days.length) - 1));
          else if (e.key === "Escape") setAt(null);
        }} onBlur={() => setAt(null)}>
        <svg key={W > 0 ? "chart" : "x"} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block overflow-visible" role="img" aria-label={t("title")} data-testid="trend">
          <line x1="0" x2={W} y1={y(avg)} y2={y(avg)} className="stroke-line-strong" strokeDasharray="3 4" strokeWidth="1" />
          <line x1="0" x2={W} y1={zero} y2={zero} className="stroke-line-strong" strokeWidth="1" />
          <path d={area} className="mz-reveal-y fill-text-3 opacity-15" />
          <path d={line(expected)} pathLength={1} fill="none" className="mz-draw stroke-text-3" strokeWidth="1.5" strokeLinejoin="round" />
          <path d={line(real)} pathLength={1} fill="none" className="mz-draw mz-draw--late stroke-text" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
          {expected.map((v, i) => (v < 0 ? <circle key={days[i]!.day} cx={x(i)} cy={y(v)} r="4" className="fill-danger stroke-surface" strokeWidth="2" /> : null))}
          {at !== null ? (
            <g>
              <line x1={x(at)} x2={x(at)} y1="0" y2={H} className="stroke-text-3" strokeWidth="1" strokeDasharray="2 3" />
              <circle cx={x(at)} cy={y(expected[at]!)} r="4" className="fill-surface stroke-text-3" strokeWidth="2" />
              <circle cx={x(at)} cy={y(real[at]!)} r="5" className={`stroke-surface ${real[at]! < 0 ? "fill-danger" : "fill-text"}`} strokeWidth="2" />
            </g>
          ) : null}
        </svg>
        {tip && at !== null ? (
          <div className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-md bg-primary px-3 py-2 text-caption text-on-primary shadow-overlay"
            style={{ left: `${(at / Math.max(1, days.length - 1)) * 100}%`, transform: `translateX(${at > days.length / 2 ? "calc(-100% - 10px)" : "10px"})` }} dir="auto">
            <p className="font-medium">{fmtDay(tip.day)}</p>
            <p className="mt-1 flex justify-between gap-3"><span className="opacity-70">{t("expected")}</span><span className="tabular-nums"><MoneyText money={tip.expectedNet} /></span></p>
            <p className="flex justify-between gap-3"><span className="opacity-70">{t("real")}</span><span className="tabular-nums"><MoneyText money={tip.net} /></span></p>
            <p className="opacity-70">{t("orders", { count: tip.orders })}</p>
          </div>
        ) : null}
      </div>
      <div className="flex justify-between text-caption text-text-3" dir="ltr" aria-hidden="true">
        <span>{fmtDay(home.from)}</span><span>{fmtDay(home.to)}</span>
      </div>
      <table className="sr-only">
        <caption>{t("title")}</caption>
        <thead><tr><th>{t("day")}</th><th>{t("orders", { count: 2 })}</th><th>{t("expected")}</th><th>{t("real")}</th></tr></thead>
        <tbody>{days.map((d) => <tr key={d.day}><td>{fmtDay(d.day)}</td><td>{d.orders}</td><td><MoneyText money={d.expectedNet} /></td><td><MoneyText money={d.net} /></td></tr>)}</tbody>
      </table>
    </section>
  );
}
