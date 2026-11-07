"use client";

import { Words } from "@mizan/design-system/auth/react";
import { onReducedMotionChange, pauseWhenHidden, prefersReducedMotion } from "@mizan/design-system/auth-motion";
import { Icon } from "@mizan/design-system/icons/react";
import { RED_PRIORITY } from "@mizan/design-system/motion";
import { FluidMark, useRed, useStageHidden } from "@mizan/design-system/react/motion";
import { planPartnerLogo } from "@mizan/design-system/partners";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "@/i18n/navigation";
import { TRIAL_DAYS } from "@/lib/auth/intent";
import { authUi, useAuthUi, type Scene } from "@/lib/auth/ui-store";
import { GEOMETRY, lane, nodeWidth, type Geometry, type MapNode, type NodeId, type Variant } from "./geometry";
import { BEAT_MS, INTRO_MS, initialStage, markBeat, stage, type StageEvent, type StagePhase, type StageState } from "./machine";
import type { StageController } from "./animator";

const subscribeReduced = (cb: () => void) => onReducedMotionChange(cb);

/** The scene a route implies before the card says more (sign-up, Shopify, outage come from the card). */
function sceneOf(pathname: string): Scene {
  if (pathname.startsWith("/welcome")) return "welcome";
  if (pathname.startsWith("/security")) return "secure";
  return "signIn";
}

/**
 * The ink stage beside the card, part of the page (not a player, so it has no pause control): the
 * Brand 2.0 mark, the headline, a mini connections map (Mizan in the middle, the store, couriers,
 * WhatsApp and cash on delivery around it) and one example outcome. It plays a short intro (≤ 5s),
 * then stays still and moves only when the card says something happened (machine.ts): sending
 * passes dots toward Mizan once, an error tips the mark; signing in is the card's DROP (DoneState
 * takes the red, so the mark lets it go). Server-rendered as
 * its settled frame; the animator chunk loads on idle (never under reduced motion or Save-Data).
 * Out of sight or in a hidden tab nothing runs. The SVG is decorative; a sentence says the same
 * for screen readers.
 */
export function AuthStage({ variant = "app" }: { variant?: "app" | "staff" }) {
  const t = useTranslations("authStage");
  const pathname = usePathname();
  const ui = useAuthUi();
  const scene: Scene = variant === "staff" ? "staff" : ui.scene ?? sceneOf(pathname);
  const reduced = useSyncExternalStore(subscribeReduced, prefersReducedMotion, () => false);
  // Landscape phones (and the phone strip while typing) hide the stage: nothing there may claim the red.
  const hidden = useStageHidden(ui.keyboard);
  const root = useRef<HTMLElement>(null);
  const ctrl = useRef<StageController | null>(null);
  const [visible, setVisible] = useState(true);
  // Every event carries the preference it was sent under (read in effects and handlers, never in render).
  const reducedRef = useRef(reduced);
  useEffect(() => { reducedRef.current = reduced; }, [reduced]);
  const [st, dispatch] = useReducer((s: StageState, a: { e: StageEvent; reduced: boolean }) => stage(s, a.e, a.reduced), false, initialStage);
  const send = useCallback((e: StageEvent) => dispatch({ e, reduced: reducedRef.current }), []);
  const { phase, seq } = st;
  // One red: the outage dot while the hub is down, else the mark's ball (while the stage shows and
  // until signed in: then the card's DoneState plays the DROP with it).
  const red = useRed("auth-stage:outage", RED_PRIORITY.dot, scene === "outage");
  const markRed = scene !== "outage" && !hidden && !st.signedIn;
  // What a late animator must catch up with (it loads on idle, maybe after the intro or a send).
  const mountedAt = useRef(0);
  const now = useRef<{ phase: StagePhase; visible: boolean }>({ phase, visible });
  useEffect(() => { now.current = { phase, visible }; }, [phase, visible]);
  useEffect(() => { mountedAt.current = performance.now(); }, []);

  // The card's news (signals carry no PII: send, idle, error, signed in).
  useEffect(() => authUi.onSignal((s) => send({ type: s })), [send]);
  // Reduced motion (now or later): the settled frame, at once.
  useEffect(() => { if (reduced) dispatch({ e: { type: "introEnd" }, reduced: true }); }, [reduced]);

  // Load the animator when the page is idle (not under reduced motion or Save-Data).
  useEffect(() => {
    const el = root.current;
    if (!el || reduced || variant === "staff") return;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    if (saveData) { send({ type: "introEnd" }); return; }
    let cancelled = false;
    const start = () => {
      void import("./animator").then(({ buildStage }) => {
        if (cancelled || !root.current) return;
        const { phase: at, visible: seen } = now.current;
        const c = buildStage(root.current, { elapsed: performance.now() - mountedAt.current, intro: at === "intro" && seen });
        ctrl.current = c;
        // The effects below ran before it existed: bring it to the current phase now.
        if (at !== "intro") c.finishIntro();
        c.transfer(at === "transfer" && seen);
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
  }, [reduced, variant, send]);

  // The intro ends on its own, or at once when the stage leaves sight (it never waits to be seen again).
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    return pauseWhenHidden(el, setVisible);
  }, []);
  useEffect(() => {
    if (phase !== "intro") return;
    if (!visible) { send({ type: "introEnd" }); return; }
    const id = window.setTimeout(() => send({ type: "introEnd" }), INTRO_MS);
    return () => window.clearTimeout(id);
  }, [phase, visible, send]);
  useEffect(() => { if (phase !== "intro") ctrl.current?.finishIntro(); }, [phase]);
  // TRANSFER: one pass per send, while someone can see it.
  useEffect(() => { ctrl.current?.transfer(phase === "transfer" && visible); }, [phase, seq, visible]);
  // A beat (tip, the transfer pass) settles by itself, even if the work goes on.
  useEffect(() => {
    if (phase !== "tip" && phase !== "transfer") return;
    const id = window.setTimeout(() => send({ type: "beatEnd" }), BEAT_MS[phase]);
    return () => window.clearTimeout(id);
  }, [phase, seq, send]);

  const n = (c: React.ReactNode) => <bdi dir="ltr">{c}</bdi>;
  const beat = visible ? markBeat(phase) : null;

  return (
    <aside ref={root} className="mz-auth-stage" data-testid="auth-stage" data-scene={scene} data-variant={variant} data-phase={phase}
      data-mz-red={red ? "on" : "off"} aria-label={t("kicker")}>
      <span className="mz-auth-stage__ambient" aria-hidden="true" />
      <div className="mz-auth-stage__content">
        <span className="mz-auth-stage__kicker">{variant === "staff" ? t("staffKicker") : t("kicker")}</span>
        <div className="mz-auth-stage__copy">
          <span className="mz-auth-stage__mark" data-testid="stage-mark"><FluidMark beat={beat} beatKey={seq} claim={markRed} size={96} /></span>
          <p className="mz-auth-stage__headline" aria-hidden="true" data-words="">
            <Words text={t("headline")} />{" "}<span className="au-line2"><Words text={t("headline2")} /></span>
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
              <span className="mz-auth-roll"><span>{t.rich("outcome", { n })}</span></span>
            </div>
          </>
        )}
        <p className="au-sr">{t("srSummary")}</p>
      </div>
    </aside>
  );
}

/** The partner each node stands for (DS-3 manifest); cash on delivery is Mizan's own icon. */
const PARTNER: Record<Exclude<NodeId, "cod">, string> = { shopify: "shopify", woo: "woocommerce", bosta: "bosta", whatsapp: "whatsapp" };

/**
 * A node's mark inside a circle of diameter `d`: the partner's own one-colour file for dark
 * grounds where DS-3's gate allows it (guide read, permission, size), else its manifest monogram;
 * cash on delivery draws the `cod` icon. Never recoloured.
 */
function NodeMark({ id, d, locale }: { id: NodeId; d: number; locale: "ar" | "en" }) {
  const c = d / 2;
  if (id === "cod") {
    const s = Math.round(d * 0.58);
    return <Icon name="cod" size={s} x={c - s / 2} y={c - s / 2} className="st-icon" />;
  }
  const plan = planPartnerLogo(PARTNER[id], Math.round(d), "mono", locale);
  if (plan.kind !== "mark") {
    const text = plan.kind === "monogram" ? plan.text : plan.name.charAt(0);
    return <text className="mono" x={c} y={c + 4.5} textAnchor="middle" style={text.length > 1 ? { fontSize: 11 } : undefined}>{text}</text>;
  }
  const face = plan.dark;
  const m = plan.markPx;
  return (
    <>
      {face.tile ? <circle className="st-tile" cx={c} cy={c} r={c} /> : null}
      <svg x={c - m / 2} y={c - m / 2} width={m} height={m} viewBox={face.mark.viewBox} aria-hidden="true" focusable="false">
        {face.mark.paths.map((p, i) => <path key={i} d={p.d} fill={p.fill} />)}
      </svg>
    </>
  );
}

/**
 * One variant's map; CSS shows the one that fits the screen. Each labelled pill is as wide as its
 * label in the font actually drawn (measured once fonts are ready, and again on resize, when a
 * hidden variant shows), centred where the geometry puts it, with LABEL_END after the label.
 */
function StageSvg({ v }: { v: Variant }) {
  const t = useTranslations("authStage");
  const locale = useLocale() === "ar" ? "ar" : "en";
  const g: Geometry = GEOMETRY[v];
  const labels = useRef<Partial<Record<NodeId, SVGTextElement | null>>>({});
  const [widths, setWidths] = useState<Partial<Record<NodeId, number>>>({});

  useLayoutEffect(() => {
    if (!g.labels) return;
    let alive = true;
    const measure = () => {
      if (!alive) return;
      const next: Partial<Record<NodeId, number>> = {};
      for (const n of g.nodes) {
        const len = labels.current[n.id]?.getComputedTextLength?.() ?? 0;
        if (len > 0) next[n.id] = nodeWidth(n, len);
      }
      if (Object.keys(next).length === 0) return; // hidden at this size: measured when it shows
      setWidths((w) => (g.nodes.every((n) => w[n.id] === next[n.id]) ? w : next));
    };
    const id = requestAnimationFrame(measure);
    void document.fonts?.ready.then(measure);
    window.addEventListener("resize", measure);
    return () => { alive = false; cancelAnimationFrame(id); window.removeEventListener("resize", measure); };
  }, [g]);

  // A wider pill stays centred on its point, moved in only as far as needed to stay inside the map.
  const sized = (n: MapNode): MapNode & { left: number } => {
    const w = widths[n.id] ?? n.w;
    return { ...n, w, left: Math.max(2, Math.min(g.w - w - 2, n.x - w / 2)) };
  };
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
      {g.nodes.map(sized).map((n) => (
        // Position on the outer group, motion on the inner one: a CSS transform would replace the attribute.
        <g key={n.id} transform={`translate(${n.left} ${n.y - n.h / 2})`}><g className="st-node" data-node={n.id}>
          <rect className="st-halo" width={n.w} height={n.h} rx={n.h / 2} />
          <rect width={n.w} height={n.h} rx={n.h / 2} />
          {g.labels ? (
            <>
              <circle className="bg" cx={n.h / 2} cy={n.h / 2} r={n.h / 2 - 5} />
              <g transform="translate(5 5)"><NodeMark id={n.id} d={n.h - 10} locale={locale} /></g>
              <text ref={(el) => { labels.current[n.id] = el; }} x={n.h + 4} y={n.h / 2 + 4}>{t(`nodes.${n.id}`)}</text>
            </>
          ) : <g transform="translate(3 3)"><NodeMark id={n.id} d={n.h - 6} locale={locale} /></g>}
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
