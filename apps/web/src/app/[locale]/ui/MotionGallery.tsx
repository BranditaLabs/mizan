"use client";

import { forceReduced, type MotionDispatch } from "@mizan/design-system/motion";
import { DoneState, EventGlyph, MizanLoader } from "@mizan/design-system/react/motion";
import { EVENT_MOTION, OUTCOMES, SURFACES, type Outcome } from "@mizan/shared/motion";
import { useTranslations } from "next-intl";
import { useEffect, useState, type ReactNode } from "react";
import { Bdi } from "@/components/Bdi";
import { Button, ButtonGroup } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Choice";
import { BreakevenMeter, BullseyeMeter, GaugeMeter, VesselsMeter } from "@/components/ui/Instruments";
import { FillProgress } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { useEventMotion } from "@/lib/motion/EventMotionProvider";
import { useBrandCopy } from "@/lib/motion/useBrandCopy";

const KINDS = ["pair", "transfer", "drop", "fill", "level"] as const;
const EVENTS = Object.keys(EVENT_MOTION).sort();
const DEV = process.env.NODE_ENV !== "production";

function Panel({ ink, children, dir }: { ink?: boolean; children: ReactNode; dir?: "ltr" | "rtl" }) {
  return (
    <div dir={dir} className={`flex flex-wrap items-end justify-center gap-6 rounded-lg border border-line p-5 ${ink ? "bg-[#0B0B0B] text-[#FEF7FF]" : "bg-surface text-text"}`}>
      {children}
    </div>
  );
}

/** ICU sample values for a catalogue message, so every row reads (select branches take "other"). */
function sampleValues(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of raw.matchAll(/\{(\w+)(\s*,\s*(\w+))?/g)) {
    const name = m[1]!, kind = m[3];
    if (name in out) continue;
    out[name] = kind === "select" ? "other" : name === "system" || name === "name" ? "Shopify" : "3";
  }
  return out;
}

/**
 * The Motion section of the UI gallery (Brand 2.0): every loader on paper and on ink in both
 * directions, the interactive pair, the four instruments with sliders, every outcome with replay,
 * the whole event catalogue (one row per domain event with its glyph and copy), a "reduced" switch
 * that forces the reduced store, and in development a simulator that fires the catalogue through
 * the scheduler (storm mode included).
 */
export function MotionGallery() {
  const t = useTranslations("gallery.motion");
  const all = useTranslations();
  const copy = useBrandCopy();
  const toast = useToast();
  const [reduced, setReduced] = useState<"system" | "on" | "off">("system");
  const [replay, setReplay] = useState(0);
  const [fill, setFill] = useState(0.62);
  const [g, setG] = useState({ a: "184250.00", b: "181900.00" });
  const [v, setV] = useState({ a: 120, b: 112 });
  const [be, setBe] = useState({ a: "42000.00", b: "18000.00" });
  const [bull, setBull] = useState({ x: 1.2, y: -0.8 });

  useEffect(() => {
    forceReduced(reduced === "system" ? null : reduced === "on");
    return () => forceReduced(null);
  }, [reduced]);

  const outcomeName = (o: Outcome) => t(`outcome.${o}`);
  return (
    <div className="flex flex-col gap-6" data-mz-reduced={reduced === "on" ? "true" : undefined} data-testid="gallery-motion">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-label">{t("reduced")}</span>
        <Segmented label={t("reduced")} value={reduced} onChange={(x) => setReduced(x as typeof reduced)}
          options={[{ value: "system", label: t("reducedSystem") }, { value: "on", label: t("reducedOn") }, { value: "off", label: t("reducedOff") }]} />
      </div>

      <h3 className="text-heading-sm">{t("loaders")}</h3>
      <div className="grid gap-3 lg:grid-cols-2">
        {([false, true] as const).map((ink) => (
          <Panel key={String(ink)} ink={ink}>
            {KINDS.map((k) => (
              <figure key={k} className="flex flex-col items-center gap-2">
                <MizanLoader kind={k} size={k === "fill" ? 180 : 96} value={k === "fill" ? fill : undefined} label={t(`kind.${k}`)} valueText={copy.loader.percent(Math.round(fill * 100))} tone={!ink && k === "pair" ? "brand" : "mono"} />
                <figcaption className="text-caption opacity-70">{t(`kind.${k}`)}</figcaption>
              </figure>
            ))}
          </Panel>
        ))}
      </div>
      <p className="text-body-sm text-text-2">{t("meanings")}</p>
      <div className="grid gap-3 md:grid-cols-2">
        {(["ltr", "rtl"] as const).map((d) => (
          <Panel key={d} dir={d}>
            <span className="text-caption text-text-3">{t(`dir.${d}`)}</span>
            <MizanLoader kind="transfer" size={80} label={copy.loader.syncing} />
            <FillProgress value={fill * 100} label={t("kind.fill")} valueText={copy.loader.progress(Math.round(fill * 24), 24)} width={160} />
          </Panel>
        ))}
      </div>
      <label className="flex max-w-sm flex-col gap-1 text-body-sm">
        <span>{t("fillValue")}</span>
        <input type="range" min={0} max={1} step={0.01} value={fill} onChange={(e) => setFill(Number(e.target.value))} />
      </label>

      <h3 className="text-heading-sm">{t("interactive")}</h3>
      <Panel>
        <MizanLoader kind="pair" size={180} interactive label={t("interactiveLabel")} />
        <MizanLoader kind="level" size={180} interactive label={t("interactiveLabel")} />
      </Panel>

      <h3 className="text-heading-sm">{t("buttons")}</h3>
      <ButtonGroup>
        <Button busy pending="drop">{t("kind.drop")}</Button>
        <Button busy pending="transfer" variant="secondary">{t("kind.transfer")}</Button>
        <Button busy pending="fill" variant="secondary">{t("kind.fill")}</Button>
        <Button busy pending="pair" variant="ghost">{t("kind.pair")}</Button>
      </ButtonGroup>

      <h3 className="text-heading-sm">{t("outcomes")}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7" key={replay}>
        {OUTCOMES.map((o) => (
          <div key={o} className="flex flex-col items-center gap-2 rounded-lg border border-line bg-surface p-4" data-testid={`outcome-${o}`}>
            <EventGlyph outcome={o} size={24} label={outcomeName(o)} />
            <span className="text-label">{outcomeName(o)}</span>
            <span className="text-center text-caption text-text-2">{t(`outcomeMeaning.${o}`)}</span>
          </div>
        ))}
      </div>
      <ButtonGroup>
        <Button variant="secondary" icon="refresh" onClick={() => setReplay((n) => n + 1)}>{t("replay")}</Button>
        <Button variant="secondary" onClick={() => toast.event({ type: "order.confirmed" })}>{t("toastDrop")}</Button>
        <Button variant="secondary" onClick={() => toast.event({ type: "connection.connected" })}>{t("toastMerge")}</Button>
        <Button variant="secondary" onClick={() => toast.event({ type: "stock.short" })}>{t("toastTip")}</Button>
        <Button variant="secondary" onClick={() => toast({ message: t("toastFail"), outcome: "fail" })}>{t("toastFailLabel")}</Button>
      </ButtonGroup>
      <div className="rounded-lg border border-line bg-surface p-6" key={`done-${replay}`}>
        <DoneState label={t("doneTitle")}>
          <p className="font-display text-heading-sm">{t("doneTitle")}</p>
        </DoneState>
      </div>

      <h3 className="text-heading-sm">{t("instruments")}</h3>
      <p className="max-w-[70ch] text-body-sm text-text-2">{t("instrumentsBody")}</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
          <div className="mx-auto w-full max-w-[380px]"><GaugeMeter a={g.a} b={g.b} currency="EGP" /></div>
          <Slider label={copy.gauge.labelB} min={150000} max={220000} step={50} value={Number(g.b)} onChange={(n) => setG({ ...g, b: n.toFixed(2) })} />
        </div>
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
          <div className="mx-auto w-full max-w-[380px]"><VesselsMeter a={v.a} b={v.b} /></div>
          <Slider label={copy.vessels.labelB} min={0} max={200} step={1} value={v.b} onChange={(n) => setV({ ...v, b: n })} />
        </div>
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
          <div className="mx-auto w-full max-w-[380px]"><BreakevenMeter a={be.a} b={be.b} currency="EGP" /></div>
          <Slider label={copy.breakeven.labelB} min={0} max={80000} step={500} value={Number(be.b)} onChange={(n) => setBe({ ...be, b: n.toFixed(2) })} />
        </div>
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
          <div className="mx-auto w-full max-w-[380px]"><BullseyeMeter x={bull.x} y={bull.y} tolerance={2} /></div>
          <Slider label={copy.bullseye.labelX} min={-8} max={8} step={0.1} value={bull.x} onChange={(n) => setBull({ ...bull, x: n })} />
          <Slider label={copy.bullseye.labelY} min={-8} max={8} step={0.1} value={bull.y} onChange={(n) => setBull({ ...bull, y: n })} />
        </div>
      </div>

      <h3 className="text-heading-sm">{t("catalogue")}</h3>
      <p className="max-w-[70ch] text-body-sm text-text-2">{t("catalogueBody", { count: EVENTS.length })}</p>
      <div className="mz-table-wrap max-h-[520px] overflow-y-auto">
        <table className="mz-table" data-testid="motion-catalogue">
          <caption className="sr-only">{t("catalogue")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("col.outcome")}</th>
              <th scope="col">{t("col.event")}</th>
              <th scope="col">{t("col.copy")}</th>
              <th scope="col">{t("col.pending")}</th>
              <th scope="col">{t("col.surfaces")}</th>
            </tr>
          </thead>
          <tbody>
            {EVENTS.map((type) => {
              const rule = EVENT_MOTION[type as keyof typeof EVENT_MOTION];
              const key = rule.copy;
              const text = key && all.has(key) ? all(key, sampleValues(String(all.raw(key)))) : "—";
              return (
                <tr key={type}>
                  <td><span className="inline-flex items-center gap-2"><EventGlyph outcome={rule.outcome === "quiet" ? "settle" : rule.outcome} size={16} static />{outcomeName(rule.outcome)}</span></td>
                  <td><code className="mz-num text-caption"><Bdi>{type}</Bdi></code></td>
                  <td className="text-body-sm">{text}</td>
                  <td className="text-caption">{rule.pending ? t(`kind.${rule.pending}`) : "—"}</td>
                  <td className="text-caption text-text-2">{rule.surfaces.map((s) => t(`surface.${s}`)).join(" · ")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {DEV ? <Simulator /> : null}
    </div>
  );
}

function Slider({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange(n: number): void }) {
  return (
    <label className="flex flex-col gap-1 text-body-sm">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

/** Development only: fire the catalogue through the scheduler and watch what each surface receives. */
function Simulator() {
  const t = useTranslations("gallery.motion");
  const motion = useEventMotion();
  const [log, setLog] = useState<MotionDispatch[]>([]);
  useEffect(() => {
    const offs = SURFACES.filter((s) => s !== "toast").map((s) => motion.subscribe(s, (d) => setLog((l) => [d, ...l].slice(0, 12))));
    return () => offs.forEach((off) => off());
  }, [motion]);
  const fire = (types: readonly string[]) => types.forEach((type, i) => motion.push({ id: `sim-${type}-${Date.now()}-${i}`, type, entityId: `sim-${i}`, at: Date.now(), source: "live" }));
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed border-line-strong p-4" data-testid="motion-simulator">
      <h3 className="text-heading-sm">{t("simulator")}</h3>
      <ButtonGroup>
        <Button variant="secondary" onClick={() => fire(["order.confirmed"])}>{t("fireOne")}</Button>
        <Button variant="secondary" onClick={() => fire(EVENTS)}>{t("fireAll")}</Button>
      </ButtonGroup>
      <ul className="flex flex-col gap-1 text-caption">
        {log.map((d, i) => (
          <li key={`${d.type}-${i}`} className="flex items-center gap-2">
            <EventGlyph outcome={d.outcome as Outcome} size={14} static={i > 0} />
            <code><Bdi>{d.type}</Bdi></code>
            <span className="text-text-3"><Bdi>{d.surfaces.join(", ")}</Bdi></span>
            {d.batched ? <span className="text-text-2">{t("batched", { count: d.count })}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
