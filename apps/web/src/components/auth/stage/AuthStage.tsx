"use client";

import { ScaleMark, Words } from "@mizan/design-system/auth/react";
import { onReducedMotionChange, pauseWhenHidden, prefersReducedMotion } from "@mizan/design-system/auth-motion";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "@/i18n/navigation";
import { TRIAL_DAYS } from "@/lib/auth/intent";
import { useAuthUi, type Scene } from "@/lib/auth/ui-store";
import { GEOMETRY, lane, type Geometry, type Variant } from "./geometry";
import type { StageController } from "./animator";

const PAUSED = "mizan.stage.paused";
const OUTCOMES = ["0", "1", "2", "3", "4"] as const;
const TICK_MS = 6000;
const MAX_CYCLES = 5;

function readPaused(): boolean { try { return localStorage.getItem(PAUSED) === "1"; } catch { return false; } }
function savePaused(v: boolean) { try { localStorage.setItem(PAUSED, v ? "1" : "0"); } catch { /* a convenience */ } }
const subscribeReduced = (cb: () => void) => onReducedMotionChange(cb);

/** The scene a route implies before the card says more (sign-up, Shopify, outage come from the card). */
function sceneOf(pathname: string): Scene {
  if (pathname.startsWith("/welcome")) return "welcome";
  if (pathname.startsWith("/security")) return "secure";
  return "signIn";
}

/**
 * The ink stage beside the card: the scale, the headline, a mini connections map (Mizan in the
 * middle, the store, couriers, WhatsApp and cash on delivery around it) and an outcomes ticker
 * tagged "Example". Server-rendered as its final frame (the poster); the animator chunk loads on
 * idle and builds it (never under reduced motion or Save-Data). Scenes change it without a rebuild.
 * The SVG is decorative (aria-hidden); a sentence says the same for screen readers.
 */
export function AuthStage({ variant = "app" }: { variant?: "app" | "staff" }) {
  const t = useTranslations("authStage");
  const pathname = usePathname();
  const ui = useAuthUi();
  const scene: Scene = variant === "staff" ? "staff" : ui.scene ?? sceneOf(pathname);
  const root = useRef<HTMLElement>(null);
  const ctrl = useRef<StageController | null>(null);
  const reduced = useSyncExternalStore(subscribeReduced, prefersReducedMotion, () => false);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [focusInCard, setFocusInCard] = useState(false);
  const [tick, setTick] = useState({ at: 0, prev: -1, cycles: 0 });

  // The remembered choice is read after hydration, in the next frame (the server cannot know it).
  useEffect(() => { const id = requestAnimationFrame(() => setPaused(readPaused())); return () => cancelAnimationFrame(id); }, []);

  // Load the animator when the page is idle (not under reduced motion or Save-Data).
  useEffect(() => {
    const el = root.current;
    if (!el || reduced || variant === "staff") return;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (saveData) return;
    let cancelled = false;
    const start = () => {
      void import("./animator").then(({ buildStage }) => {
        if (cancelled || !root.current) return;
        ctrl.current = buildStage(root.current);
        if (readPaused()) ctrl.current.pause();
      });
    };
    const ric = (window as Window & { requestIdleCallback?(cb: () => void, o?: { timeout: number }): number }).requestIdleCallback;
    const id = ric ? ric(start, { timeout: 1200 }) : window.setTimeout(start, 600);
    return () => {
      cancelled = true;
      if (!ric) window.clearTimeout(id);
      ctrl.current?.destroy();
      ctrl.current = null;
    };
  }, [reduced, variant]);

  // Loops run only while someone can see them, nobody paused them, and the keyboard is closed.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    return pauseWhenHidden(el, setVisible);
  }, []);
  const playing = visible && !paused && !ui.keyboard && !reduced;
  useEffect(() => { if (playing) ctrl.current?.play(); else ctrl.current?.pause(); }, [playing]);

  // The ticker waits while someone is typing in the card.
  useEffect(() => {
    const on = (e: FocusEvent) => setFocusInCard(Boolean((e.target as Element | null)?.closest?.(".mz-auth-card input, .mz-auth-card select")));
    document.addEventListener("focusin", on);
    document.addEventListener("focusout", () => setFocusInCard(false));
    return () => document.removeEventListener("focusin", on);
  }, []);
  useEffect(() => {
    if (!playing || focusInCard || tick.cycles >= MAX_CYCLES * OUTCOMES.length || variant === "staff") return;
    const id = window.setTimeout(() => setTick((s) => ({ at: (s.at + 1) % OUTCOMES.length, prev: s.at, cycles: s.cycles + 1 })), TICK_MS);
    return () => window.clearTimeout(id);
  }, [playing, focusInCard, tick, variant]);

  const n = (c: React.ReactNode) => <bdi dir="ltr">{c}</bdi>;
  const togglePause = () => { setPaused((p) => { savePaused(!p); return !p; }); };
  const headline = t("headline");

  return (
    <aside ref={root} className="mz-auth-stage" data-testid="auth-stage" data-scene={scene} data-variant={variant} aria-label={t("kicker")}>
      <span className="mz-auth-stage__ambient" aria-hidden="true" data-drift="" />
      <div className="mz-auth-stage__content">
        <span className="mz-auth-stage__kicker">{variant === "staff" ? t("staffKicker") : t("kicker")}</span>
        <div className="mz-auth-stage__copy">
          <span className="mz-auth-stage__scale"><ScaleMark size={64} /></span>
          <p className="mz-auth-stage__headline" aria-hidden="true" data-words="">
            <Words text={headline} />{" "}<span className="au-line2"><Words text={t("headline2")} /></span>
          </p>
        </div>
        {variant === "staff" ? null : (
          <>
            <div className="mz-auth-stage__map" aria-hidden="true">
              <StageSvg v="island" />
              <StageSvg v="band" />
              <StageSvg v="strip" />
            </div>
            <div className="mz-auth-stage__ticker" aria-hidden="true">
              <span className="mz-auth-tag">{t("example")}</span>
              <span className="mz-auth-roll">
                {tick.prev >= 0 ? <span key={`o-${tick.cycles}`} data-out="">{t.rich(`outcomes.${OUTCOMES[tick.prev]!}`, { n })}</span> : null}
                <span key={`i-${tick.cycles}`} data-in={tick.prev >= 0 ? "" : undefined}>{t.rich(`outcomes.${OUTCOMES[tick.at]!}`, { n })}</span>
              </span>
            </div>
          </>
        )}
        <p className="au-sr">{t("srSummary")}</p>
        {variant === "staff" || reduced ? null : (
          <button type="button" className="mz-auth-pause" data-testid="stage-pause" aria-pressed={paused} onClick={togglePause}
            aria-label={paused ? t("play") : t("pause")}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="currentColor">
              {paused ? <path d="M3 1.8v10.4L12 7z" /> : <><rect x="2.5" y="1.5" width="3" height="11" rx="1" /><rect x="8.5" y="1.5" width="3" height="11" rx="1" /></>}
            </svg>
          </button>
        )}
      </div>
    </aside>
  );
}

/** One variant's map; CSS shows the one that fits the screen. */
function StageSvg({ v }: { v: Variant }) {
  const t = useTranslations("authStage");
  const g: Geometry = GEOMETRY[v];
  return (
    <svg className={`mz-auth-map au-v-${v}`} viewBox={`0 0 ${g.w} ${g.h}`} preserveAspectRatio="xMidYMid meet" data-variant={v} focusable="false">
      <g className="st-edges">
        {g.nodes.map((n) => <path key={n.id} className="st-edge on" data-edge={n.id} d={lane(g, n).d} />)}
      </g>
      <g className="st-particles" />
      {g.labels ? (
        <g transform={`translate(${g.ghost.x - g.ghost.w / 2} ${g.ghost.y - g.ghost.h / 2})`}>
          <g className="st-node st-ghost" data-node="store">
            <rect width={g.ghost.w} height={g.ghost.h} rx={g.ghost.h / 2} />
            <text x={g.ghost.w / 2} y={g.ghost.h / 2 + 4} textAnchor="middle">{t("nodes.store")}</text>
          </g>
        </g>
      ) : null}
      {g.nodes.map((n) => (
        // Position on the outer group, motion on the inner one: a CSS transform would replace the attribute.
        <g key={n.id} transform={`translate(${n.x - n.w / 2} ${n.y - n.h / 2})`}><g className="st-node" data-node={n.id}>
          <rect className="st-halo" width={n.w} height={n.h} rx={n.h / 2} />
          <rect width={n.w} height={n.h} rx={n.h / 2} />
          {g.labels ? (
            <>
              <circle className="bg" cx={n.h / 2} cy={n.h / 2} r={n.h / 2 - 5} />
              <text className="mono" x={n.h / 2} y={n.h / 2 + 4.5} textAnchor="middle">{n.mono}</text>
              <text x={n.h + 4} y={n.h / 2 + 4}>{t(`nodes.${n.id}`)}</text>
            </>
          ) : <text className="mono" x={n.w / 2} y={n.h / 2 + 4.5} textAnchor="middle">{n.mono}</text>}
        </g></g>
      ))}
      <g transform={`translate(${g.hub.x} ${g.hub.y})`}><g className="st-hub">
        <circle className="ring" r={g.hub.r} />
        <text y={4.5} textAnchor="middle">{t("nodes.hub")}</text>
        <circle className="st-red" cx={g.hub.r * 0.72} cy={-g.hub.r * 0.72} r={5} />
        {g.labels ? (
          <g transform={`translate(0 ${-g.hub.r - 16})`}><g className="st-badge trial">
            <rect x={-44} y={-11} width={88} height={22} rx={11} />
            <text y={4} textAnchor="middle">{t("trialTag", { days: TRIAL_DAYS, n: String(TRIAL_DAYS) })}</text>
          </g></g>
        ) : null}
      </g></g>
    </svg>
  );
}
