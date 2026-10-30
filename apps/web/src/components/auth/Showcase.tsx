"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Wordmark } from "@/components/Wordmark";
import { MoneyText } from "@/components/ui/Values";

type Stage = "placed" | "confirmed" | "shipped" | "delivered" | "cash" | "refused" | "returned";
type Cost = "product" | "shipping" | "codFee" | "paymentFee" | "team" | "packaging" | "ads" | "returnLeg";
interface Sample {
  number: string;
  item: "abaya" | "bag" | "sneakers";
  pay: "cod" | "card";
  total: number;
  stages: readonly Stage[];
  /** Where the money becomes real: from this stage on, revenue counts. */
  realAt: Stage | null;
  costs: ReadonlyArray<readonly [Cost, number]>;
}

/**
 * Sample orders for the sign-in screen, in EGP, with costs that add up the way the profit engine
 * counts them (docs/04 §5): a COD order delivered, a card order delivered, a COD order refused at the
 * door (shipping and the return leg lost, no revenue). Shown as samples, never as anyone's figures.
 */
const SAMPLES: readonly Sample[] = [
  {
    number: "M-1042", item: "abaya", pay: "cod", total: 1250, realAt: "cash",
    stages: ["placed", "confirmed", "shipped", "delivered", "cash"],
    costs: [["product", 800], ["shipping", 60], ["codFee", 18.75], ["team", 12], ["packaging", 7.5], ["ads", 95]],
  },
  {
    number: "M-1043", item: "bag", pay: "card", total: 900, realAt: "placed",
    stages: ["placed", "confirmed", "shipped", "delivered"],
    costs: [["product", 480], ["shipping", 55], ["paymentFee", 26.75], ["packaging", 7.5], ["ads", 70]],
  },
  {
    number: "M-1044", item: "sneakers", pay: "cod", total: 640, realAt: null,
    stages: ["placed", "confirmed", "shipped", "refused", "returned"],
    costs: [["shipping", 60], ["returnLeg", 30], ["team", 12], ["packaging", 7.5], ["ads", 80]],
  },
];
const STEP_MS = 1700;
const REDUCE = "(prefers-reduced-motion: reduce)";
const prefersReduced = () => window.matchMedia(REDUCE).matches;
function onMotionChange(cb: () => void) {
  const q = window.matchMedia(REDUCE);
  q.addEventListener("change", cb);
  return () => q.removeEventListener("change", cb);
}
const HOLD_STEPS = 3; // the finished order stays on screen a little longer
const egp = (n: number) => ({ amount: n.toFixed(2), currency: "EGP" });

/** One order's state at a step: which stages are done, what is real, what it cost so far. */
function at(s: Sample, step: number) {
  const done = Math.min(step, s.stages.length - 1);
  const stage = s.stages[done]!;
  const real = s.realAt !== null && done >= s.stages.indexOf(s.realAt);
  const ended = done === s.stages.length - 1;
  // Costs appear as the order earns them: ads and product at once, the rest once it moves.
  const costs = s.costs.filter(([k]) => k === "ads" || k === "product" || k === "team" || done >= 2 || (k === "paymentFee" && real))
    .filter(([k]) => k !== "returnLeg" || stage === "returned");
  const spent = costs.reduce((a, [, v]) => a + v, 0);
  const revenue = real ? s.total : 0;
  return { done, stage, real, ended, costs, spent, revenue, net: revenue - spent };
}

/**
 * The brand side of the sign-in screen (Mizan = the scale): a sample order moving from checkout to
 * cash, its costs added as they happen, and the scale settling on what it really made. Pauses on
 * request and stays still for people who reduce motion.
 */
export function Showcase({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("auth.showcase");
  const [tick, setTick] = useState(0);
  const reduced = useSyncExternalStore(onMotionChange, prefersReduced, () => false);
  const [choice, setPlaying] = useState<boolean | null>(null);
  // Plays unless the person reduces motion, until they press pause or play.
  const playing = choice ?? !reduced;

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setTick((n) => n + 1), STEP_MS);
    return () => window.clearInterval(id);
  }, [playing]);

  // Walk the samples one after another: each runs its stages, then holds its result.
  const spans = SAMPLES.map((s) => s.stages.length + HOLD_STEPS);
  const cycle = spans.reduce((a, b) => a + b, 0);
  let n = tick % cycle;
  let i = 0;
  while (n >= spans[i]!) { n -= spans[i]!; i += 1; }
  const s = SAMPLES[i]!;
  const v = at(s, n);
  const loss = v.ended && v.net < 0;
  const scale = Math.max(s.total, v.spent);
  const pct = (x: number) => `${Math.round((x / scale) * 100)}%`;

  const order = (
    <figure className="flex flex-col gap-5 rounded-xl bg-rail-surface p-5 sm:p-6" data-testid="showcase-order" aria-label={t("caption")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-body-sm text-rail-text-2">{t("caption")}</p>
          <p className="mt-1 text-heading-sm">
            <bdi dir="ltr" className="tabular-nums">{s.number}</bdi>
            <span className="text-rail-text-2"> · {t(`item.${s.item}`)}</span>
          </p>
          <p className="mt-0.5 text-body-sm text-rail-text-2">{t(`pay.${s.pay}`)} · <MoneyText money={egp(s.total)} /></p>
        </div>
        <button type="button" onClick={() => setPlaying(!playing)} aria-pressed={!playing}
          className="shrink-0 rounded-full bg-rail-line px-3 py-1.5 text-caption text-rail-text transition-transform duration-150 hover:scale-[1.04] active:scale-95">
          {playing ? t("pause") : t("play")}
        </button>
      </div>

      <ol className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${s.stages.length}, minmax(0, 1fr))` }} aria-label={t("stagesLabel")}>
        {s.stages.map((st, k) => {
          const done = k <= v.done;
          const bad = st === "refused" || st === "returned";
          return (
            <li key={st} className="flex min-w-0 flex-col gap-1.5" aria-current={k === v.done ? "step" : undefined}>
              <span className={`h-1.5 rounded-full transition-colors duration-500 ${done ? (bad ? "bg-brand" : "bg-rail-text") : "bg-rail-line"}`} />
              <span className={`truncate text-caption transition-colors duration-500 ${k === v.done ? "text-rail-text" : "text-rail-text-2"}`}>{t(`stage.${st}`)}</span>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-col gap-2.5" aria-live="off">
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between text-body-sm">
            <span className="text-rail-text-2">{v.real ? t("revenue") : t("expected")}</span>
            <MoneyText money={egp(v.real ? v.revenue : s.total)} />
          </div>
          <span className="block h-2 overflow-hidden rounded-full bg-rail-line">
            <span className={`block h-full rounded-full transition-[width,opacity] duration-700 ease-out ${v.real ? "bg-rail-text" : "bg-rail-text opacity-30"}`}
              style={{ width: pct(v.real ? v.revenue : s.total) }} />
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between text-body-sm">
            <span className="text-rail-text-2">{t("costs")}</span>
            <MoneyText money={egp(v.spent)} />
          </div>
          <span className="block h-2 overflow-hidden rounded-full bg-rail-line">
            <span className="block h-full rounded-full bg-rail-text-2 transition-[width] duration-700 ease-out" style={{ width: pct(v.spent) }} />
          </span>
          {compact ? null : (
            <p className="mt-0.5 flex min-h-[2.75em] flex-wrap gap-x-3 gap-y-0.5 text-caption text-rail-text-2">
              {v.costs.map(([k, amount]) => (
                <span key={k} className="whitespace-nowrap">{t(`cost.${k}`)} <MoneyText money={egp(amount)} /></span>
              ))}
            </p>
          )}
        </div>
      </div>

      <div className="flex items-end justify-between gap-3">
        <span className="text-body-sm text-rail-text-2">{v.ended ? (loss ? t("loss") : t("net")) : t("expectedNet")}</span>
        <span className={`text-kpi tabular-nums transition-colors duration-500 ${loss ? "text-brand" : "text-rail-text"}`}>
          <MoneyText money={egp(v.ended ? v.net : s.total - v.spent)} />
        </span>
      </div>
    </figure>
  );

  if (compact) return order;
  return (
    <div className="flex h-full flex-col justify-between gap-8 overflow-y-auto p-10 xl:p-14">
      <Wordmark onDark className="h-7 w-auto shrink-0 self-start" />
      <div className="flex max-w-[540px] flex-col gap-7">
        <div className="flex flex-col gap-3">
          <p className="font-display text-display-md text-white text-balance">{t("headline")}</p>
          <p className="max-w-[46ch] text-body-lg text-rail-text-2">{t("lede")}</p>
        </div>
        <Scale revenue={v.real ? v.revenue : s.total} expected={!v.real} costs={v.spent} loss={loss} />
        {order}
      </div>
      <p className="text-body-sm text-rail-text-2">{t("worksWith")}</p>
    </div>
  );
}

const PIVOT = { x: 160, y: 34 };
const ARM = 118;
const MAX_TILT = 14;
const SWING = "transform 900ms cubic-bezier(0.32, 0.72, 0, 1)";

/**
 * The scale (ميزان): revenue in the pan on the reading-start side, costs in the other. The beam tips
 * toward the heavier pan and settles; the pivot is the brand's one red point. Drawn in code; the
 * pans hang level because they move with the beam's ends rather than turn with it.
 */
function Scale({ revenue, expected, costs, loss }: { revenue: number; expected: boolean; costs: number; loss: boolean }) {
  const t = useTranslations("auth.showcase");
  const rtl = useLocale() === "ar";
  const heavier = Math.max(revenue, costs, 1);
  // Positive: the costs side is down. Revenue sits on the start side: the left in English, the right in Arabic.
  const tilt = Math.max(-MAX_TILT, Math.min(MAX_TILT, ((costs - revenue) / heavier) * MAX_TILT * 1.6));
  const angle = rtl ? -tilt : tilt;
  const rad = (angle * Math.PI) / 180;
  // Where an end of the beam is, relative to the pivot (side -1: left, 1: right).
  const end = (side: -1 | 1) => ({ x: side * ARM * Math.cos(rad), y: side * ARM * Math.sin(rad) });
  const revenueFill = expected ? "fill-rail-text opacity-30" : "fill-rail-text";
  const costsFill = loss ? "fill-brand" : "fill-rail-text-2";
  /** A pan hung from one end: strings to a dish, moved with that end, never turned. */
  const pan = (side: -1 | 1, fill: string) => {
    const at = end(side);
    return (
      <g style={{ transform: `translate(${at.x}px, ${at.y}px)`, transition: SWING }}>
        <line x1={PIVOT.x} y1={PIVOT.y} x2={PIVOT.x - 26} y2={PIVOT.y + 62} className="stroke-rail-text-2" strokeWidth="1" />
        <line x1={PIVOT.x} y1={PIVOT.y} x2={PIVOT.x + 26} y2={PIVOT.y + 62} className="stroke-rail-text-2" strokeWidth="1" />
        <path d={`M${PIVOT.x - 34} ${PIVOT.y + 62} Q ${PIVOT.x} ${PIVOT.y + 92} ${PIVOT.x + 34} ${PIVOT.y + 62} Z`} className={`${fill} transition-[fill,opacity] duration-700`} />
      </g>
    );
  };
  return (
    <figure className="flex flex-col gap-3" aria-label={t("scaleLabel")}>
      <svg viewBox="0 0 320 150" className="h-auto w-full max-w-[420px] overflow-visible" aria-hidden="true">
        <path d="M160 34 L160 132 M128 140 Q160 124 192 140 Z" className="fill-rail-surface stroke-rail-text-2" strokeWidth="1.25" strokeLinejoin="round" />
        <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: `${PIVOT.x}px ${PIVOT.y}px`, transition: SWING }}>
          <line x1={PIVOT.x - ARM} y1={PIVOT.y} x2={PIVOT.x + ARM} y2={PIVOT.y} className="stroke-rail-text" strokeWidth="2.5" strokeLinecap="round" />
        </g>
        {pan(-1, rtl ? costsFill : revenueFill)}
        {pan(1, rtl ? revenueFill : costsFill)}
        <circle cx={PIVOT.x} cy={PIVOT.y} r="5" className="fill-brand" />
      </svg>
      <figcaption className="flex max-w-[420px] justify-between text-caption text-rail-text-2">
        <span>{expected ? t("expected") : t("revenue")} <MoneyText money={egp(revenue)} /></span>
        <span className={loss ? "text-brand" : undefined}>{t("costs")} <MoneyText money={egp(costs)} /></span>
      </figcaption>
    </figure>
  );
}
