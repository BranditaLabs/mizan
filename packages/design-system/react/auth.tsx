"use client";

/**
 * The auth kit shared by the dashboard (apps/web) and the back office (apps/admin): the persistent
 * step host with its motion, the step header, fields (text, password, one-time code), the resend
 * timer, the primary key button, alerts, the scale mark and the success mark. Styled by
 * css/auth.css (`.mz-auth-*`), animated by js/auth-motion.ts. No i18n library here: every visible
 * word comes in as a prop, so each app keeps its own messages and e2e labels.
 */

import {
  Children, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref,
} from "react";
import { Icon } from "../icons/react";
import { mmss, normalizeCode, shouldAutoSubmit } from "../js/auth-code";
import { flipSurface, interrupt, ms, prefersReducedMotion, revealWords, run, stepEnter, stepExit, type Direction } from "../js/auth-motion";

const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;
const cx = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(" ");

/* ───────────── Live region ───────────── */

const recent = new Map<string, number>();
/**
 * Says something politely through the frame's `#auth-live` (role=status). The same message is
 * not repeated within 2s. Errors never come here: they carry role=alert themselves.
 */
export function announce(message: string, liveId = "auth-live"): void {
  if (typeof document === "undefined" || !message) return;
  const now = Date.now();
  if ((recent.get(message) ?? 0) > now - 2000) return;
  recent.set(message, now);
  const el = document.getElementById(liveId);
  if (!el) return;
  el.textContent = "";
  window.setTimeout(() => { el.textContent = message; }, 30);
}

/* ───────────── Step host: one step at a time, the outgoing one kept for its exit ───────────── */

export type StepFocus = "field" | "code" | "heading" | "none";

/** Attributes that would let the exiting copy be found by label, id, role name or test id. */
const GHOST_STRIP = ["id", "for", "name", "aria-labelledby", "aria-describedby", "aria-label", "aria-controls", "data-testid", "role", "tabindex", "autofocus"];

/**
 * A still copy of the outgoing step for its exit: plain DOM (no React, so no effects run again,
 * nothing re-announces or steals focus), inert and aria-hidden, without ids, labels' targets,
 * names or test ids, so it can never be mistaken for the live step by a screen reader, a password
 * manager or a test. Typed values are copied so the exit shows what was there.
 */
function ghostOf(el: HTMLElement): HTMLElement {
  const copy = el.cloneNode(true) as HTMLElement;
  const from = el.querySelectorAll<HTMLInputElement>("input, textarea, select");
  copy.querySelectorAll<HTMLInputElement>("input, textarea, select").forEach((c, i) => {
    const o = from[i];
    if (o && "value" in o && o.type !== "password") c.setAttribute("value", o.value);
    if (o?.type === "password") c.setAttribute("value", o.value ? "•".repeat(Math.min(o.value.length, 24)) : "");
    if (o?.type === "password") c.setAttribute("type", "text");
  });
  for (const node of [copy, ...copy.querySelectorAll<HTMLElement>("*")]) for (const a of GHOST_STRIP) node.removeAttribute(a);
  copy.setAttribute("data-ghost", "");
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
  return copy;
}

/**
 * Hosts the current step of a flow. When `stepKey` changes, a still copy of the outgoing step
 * stays (absolute, inert, aria-hidden) for its exit while the incoming one is live at once; focus
 * moves at 0ms (first empty field, the code input, or the H1 for informational steps) and never
 * during an exit. The card's surface follows the height (FLIP). `direction` decides the slide.
 */
export function StepHost({ stepKey, direction = "forward", focus = "field", autoFocusFields = true, children, className, name }: {
  stepKey: string; direction?: Direction; focus?: StepFocus; autoFocusFields?: boolean; children: ReactNode; className?: string; name?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const live = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const lastHeight = useRef(0);
  const ghost = useRef<HTMLElement | null>(null);
  const shownKey = useRef(stepKey);
  // The outgoing step is copied before React replaces it: in render, while the old DOM is still there.
  const pending = useRef<{ copy: HTMLElement; direction: Direction } | null>(null);
  if (shownKey.current !== stepKey) {
    shownKey.current = stepKey;
    pending.current = live.current ? { copy: ghostOf(live.current), direction } : null;
  }

  // Enter (and focus) when the key changes; the first render is the page's own first paint.
  useIso(() => {
    const el = live.current;
    if (!el) return;
    if (first.current) {
      first.current = false;
      if (autoFocusFields && focus !== "heading" && window.matchMedia?.("(pointer: fine)").matches) moveFocus(el, focus);
      return;
    }
    const out = pending.current;
    pending.current = null;
    ghost.current?.remove();
    ghost.current = null;
    if (out && host.current) {
      const copy = out.copy;
      host.current.insertBefore(copy, el);
      ghost.current = copy;
      const drop = () => { copy.remove(); if (ghost.current === copy) ghost.current = null; };
      // Removed when the exit ends, and in any case shortly after (an interrupted exit never leaves it behind).
      const fallback = window.setTimeout(drop, ms("fast", copy) + 400);
      void stepExit(copy, out.direction).then(() => { window.clearTimeout(fallback); drop(); });
    }
    moveFocus(el, focus);
    void stepEnter(el, out?.direction ?? direction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);

  useEffect(() => () => { ghost.current?.remove(); }, []);

  // The card surface follows this host's height, for step changes and for errors that appear inside a step.
  useIso(() => {
    const el = host.current;
    if (!el || typeof ResizeObserver !== "function") return;
    const surface = el.closest(".mz-auth-card")?.querySelector<HTMLElement>(":scope > .mz-auth-card__surface");
    lastHeight.current = el.getBoundingClientRect().height;
    const ro = new ResizeObserver(() => {
      const h = el.getBoundingClientRect().height;
      if (surface && lastHeight.current) flipSurface(surface, lastHeight.current, h);
      lastHeight.current = h;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={host} className={cx("mz-auth-host", className)}>
      <div key={`s-${stepKey}`} ref={live} className="mz-auth-step" data-testid="auth-step" data-step={name ?? stepKey}>{children}</div>
    </div>
  );
}

function moveFocus(el: HTMLElement, focus: StepFocus) {
  if (focus === "none") return;
  const target = focus === "heading"
    ? el.querySelector<HTMLElement>("h1")
    : focus === "code"
      ? el.querySelector<HTMLElement>("[data-code-input]")
      : [...el.querySelectorAll<HTMLInputElement>("input:not([type=hidden]):not([readonly]):not([disabled]), select")].find((i) => !i.value) ?? el.querySelector<HTMLElement>("h1");
  if (!target) return;
  target.focus({ preventScroll: true });
  target.scrollIntoView?.({ block: "nearest" });
}

/* ───────────── Step header ───────────── */

/** Splits a heading into words for the reveal; text content stays exactly the heading's text. */
export function Words({ text }: { text: string }) {
  const parts = text.split(/(\s+)/);
  return <>{parts.map((p, i) => (/^\s+$/.test(p) || !p ? p : <span key={i} className="au-w">{p}</span>))}</>;
}

/** The step's tile (an ink icon, never green), its H1 (focusable for screen readers) and its body. */
export function StepHeader({ title, body, icon, kicker, id }: { title: string; body?: ReactNode; icon?: Parameters<typeof Icon>[0]["name"]; kicker?: ReactNode; id?: string }) {
  return (
    <div className="mz-auth-head">
      {icon ? <span className="mz-auth-tile" aria-hidden="true"><Icon name={icon} size={20} /></span> : null}
      {kicker ? <span className="mz-auth-kicker">{kicker}</span> : null}
      <h1 id={id} className="mz-auth-h1" tabIndex={-1} data-words=""><Words text={title} /></h1>
      {body ? <p className="mz-auth-sub">{body}</p> : null}
    </div>
  );
}

/** "Back" at the top of a step; the arrow follows the reading direction. */
export function BackButton({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button type="button" className="mz-auth-back" onClick={onClick} data-stagger="">
      <Icon name="back" size={16} />
      {label}
    </button>
  );
}

/* ───────────── Fields ───────────── */

export type HelpTone = "hint" | "error" | "ok" | "warn";

/** The helper slot under a control: always 20px tall, an error replaces the hint in place and rolls in. */
export function Help({ id, tone = "hint", children }: { id: string; tone?: HelpTone; children?: ReactNode }) {
  return (
    <div id={id} className="mz-auth-help" data-tone={tone} role={tone === "error" ? "alert" : undefined}>
      {children ? (
        <span key={tone} className={tone === "error" ? "au-roll" : undefined}>
          {tone === "error" ? <Icon name="error" size={14} /> : tone === "ok" ? <Icon name="success" size={14} /> : null}
          <span>{children}</span>
        </span>
      ) : null}
    </div>
  );
}

type TextFieldProps = {
  label: string; aside?: ReactNode; hint?: ReactNode; error?: ReactNode; helpTone?: Exclude<HelpTone, "error">;
  extraDescribedBy?: string; inputRef?: Ref<HTMLInputElement>; trailing?: ReactNode; controlClassName?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "size">;

/** A text field: label above (an aside link may sit at the row's end), the control, the reserved helper slot. */
export function TextField({ label, aside, hint, error, helpTone = "hint", extraDescribedBy, inputRef, trailing, controlClassName, id: given, className, ...input }: TextFieldProps) {
  const auto = useId();
  const id = given ?? auto;
  const help = `${id}-help`;
  return (
    <div className="mz-auth-field" data-stagger="">
      <span className="mz-auth-label">
        <label htmlFor={id}>{label}</label>
        {aside}
      </span>
      <div className={cx("mz-auth-control", controlClassName)} data-invalid={error ? "" : undefined}>
        <input id={id} ref={inputRef} aria-invalid={error ? true : undefined} aria-describedby={[help, extraDescribedBy].filter(Boolean).join(" ")}
          {...input} className={cx("mz-auth-input", trailing ? "au-has-aside" : null, className)} />
        {trailing}
      </div>
      <Help id={help} tone={error ? "error" : helpTone}>{error ?? hint}</Help>
    </div>
  );
}

/**
 * A password with show/hide. The button's accessible name is its visible text ("Show"/"Hide"),
 * never "Show password", so a label search for "Password" finds only the field. The caret stays
 * where it was when the type flips. Caps Lock is noted in the helper slot.
 */
export function PasswordField({ showLabel, hideLabel, capsLabel, hint, error, below, inputRef, ...props }: Omit<TextFieldProps, "type" | "trailing"> & {
  showLabel: string; hideLabel: string; capsLabel: string; below?: ReactNode;
}) {
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  const own = useRef<HTMLInputElement | null>(null);
  const id = useId();
  const setRef = useCallback((el: HTMLInputElement | null) => {
    own.current = el;
    if (typeof inputRef === "function") inputRef(el);
    else if (inputRef) (inputRef as { current: HTMLInputElement | null }).current = el;
  }, [inputRef]);
  const toggle = () => {
    const el = own.current;
    const start = el?.selectionStart ?? null;
    const end = el?.selectionEnd ?? null;
    setShown((s) => !s);
    requestAnimationFrame(() => { if (el && start !== null && document.activeElement === el) el.setSelectionRange(start, end ?? start); });
  };
  const capsCheck = (e: { getModifierState?(k: string): boolean }) => setCaps(Boolean(e.getModifierState?.("CapsLock")));
  return (
    <div className="mz-auth-pw">
      <TextField {...props} id={props.id ?? id} inputRef={setRef} type={shown ? "text" : "password"} dir="ltr" spellCheck={false} autoCapitalize="none"
        error={error} hint={caps && !error ? capsLabel : hint} helpTone={caps && !error ? "warn" : "hint"}
        onKeyDown={(e) => { capsCheck(e); props.onKeyDown?.(e); }} onKeyUp={(e) => { capsCheck(e); props.onKeyUp?.(e); }}
        trailing={(
          <button type="button" className="mz-auth-reveal" aria-pressed={shown} aria-controls={props.id ?? id} onClick={toggle}>
            <Icon name={shown ? "hidden" : "visible"} size={16} />
            {shown ? hideLabel : showLabel}
          </button>
        )} />
      {below}
    </div>
  );
}

/**
 * The one-time code: one real input over six drawn boxes, so typing, pasting a whole SMS, the
 * phone's one-time-code autofill and Playwright's fill() all work and screen readers see one field.
 * No maxlength (a pasted sentence is parsed, not truncated); Arabic-Indic and Persian digits count.
 * At 6 digits it calls `onComplete` once per distinct value, 80ms later so the last digit is seen.
 */
export function CodeField({ label, value, onChange, onComplete, length = 6, busy = false, error, invalid = false, hint, describedBy, rejected = null, name = "code" }: {
  label: string; value: string; onChange(v: string): void; onComplete?(v: string): void; length?: number; busy?: boolean;
  /** A message under the boxes (role=alert there). */
  error?: ReactNode;
  /** The danger ring only, when the message is the form's alert (a refused code). */
  invalid?: boolean;
  hint?: ReactNode; describedBy?: string; rejected?: string | null; name?: string;
}) {
  const bad = Boolean(error) || invalid;
  const id = useId();
  const help = `${id}-help`;
  const input = useRef<HTMLInputElement>(null);
  const row = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const digits = value.slice(0, length);
  const done = useRef<string | null>(null);

  useEffect(() => {
    if (!onComplete || !shouldAutoSubmit(digits, { length, busy, rejected }) || done.current === digits) return;
    const t = window.setTimeout(() => {
      done.current = digits;
      if (!prefersReducedMotion() && row.current) {
        row.current.setAttribute("data-wave", "");
        window.setTimeout(() => row.current?.removeAttribute("data-wave"), ms("slow") + length * 30);
      }
      onComplete(digits);
    }, ms("instant"));
    return () => window.clearTimeout(t);
  }, [digits, busy, rejected, length, onComplete]);

  // After a refusal the whole value is selected, so the next keystroke or paste replaces it.
  useEffect(() => {
    if (bad && input.current) {
      input.current.focus({ preventScroll: true });
      input.current.select();
    }
  }, [bad, error, rejected]);

  const active = Math.min(digits.length, length - 1);
  return (
    <div className="mz-auth-field" data-stagger="">
      <label htmlFor={id} className="mz-auth-label">{label}</label>
      <div ref={row} className="mz-auth-code" dir="ltr" style={{ ["--au-len" as string]: length }} data-invalid={bad ? "" : undefined}>
        {Array.from({ length }, (_, i) => (
          <span key={i} aria-hidden="true" className="mz-auth-code__box" style={{ ["--i" as string]: i }}
            data-filled={digits[i] ? "" : undefined} data-on={focused && i === active ? "" : undefined}>
            {digits[i] ?? (focused && i === active ? <i className="mz-auth-code__caret" /> : "")}
          </span>
        ))}
        <input ref={input} id={id} name={name} value={digits} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="one-time-code" enterKeyHint="done"
          required aria-required="true" aria-invalid={bad ? true : undefined} readOnly={busy} aria-describedby={[describedBy, help].filter(Boolean).join(" ")}
          data-code-input="" dir="ltr" spellCheck={false} autoCorrect="off"
          onChange={(e) => onChange(normalizeCode(e.target.value, length))}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
      </div>
      <Help id={help} tone={error ? "error" : "hint"}>{error ?? hint}</Help>
    </div>
  );
}

/**
 * "Resend in 0:59", then a button. The countdown ticks silently (aria-live off); when it reaches 0
 * the button rolls in and `readyMessage` is announced once. `seconds` restarts the countdown when
 * its `startedAt` changes.
 */
export function ResendTimer({ seconds, startedAt, countdown, resendLabel, readyMessage, onResend, busy = false, sentLabel, justSent = false }: {
  seconds: number; startedAt: number; countdown(time: ReactNode): ReactNode; resendLabel: string; readyMessage?: string;
  onResend(): void; busy?: boolean; sentLabel?: string; justSent?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const left = Math.max(0, Math.ceil((startedAt + seconds * 1000 - now) / 1000));
  const announced = useRef(0);
  useEffect(() => {
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [startedAt]);
  useEffect(() => {
    if (left === 0 && readyMessage && announced.current !== startedAt) {
      announced.current = startedAt;
      announce(readyMessage);
    }
  }, [left, readyMessage, startedAt]);
  return (
    <div className="mz-auth-resend" data-testid="code-resend" data-stagger="">
      {justSent && sentLabel ? <span className="mz-auth-sent"><Icon name="success" size={14} />{sentLabel}</span> : <span />}
      {left > 0 ? (
        <span aria-live="off">{countdown(<bdi dir="ltr">{mmss(left)}</bdi>)}</span>
      ) : (
        <span className="au-roll" key="ready">
          <button type="button" className="mz-auth-link" onClick={onResend} aria-disabled={busy || undefined} disabled={busy}>{resendLabel}</button>
        </span>
      )}
    </div>
  );
}

/* ───────────── Buttons ───────────── */

/**
 * The primary action as the Brandita key: an ink pill, the label at the start, a circle with an
 * arrow at the end (it turns on hover and focus). Busy and done keep the width; `aria-disabled`
 * (never `disabled`) so the button stays focusable and its reason can be read.
 */
export function PrimaryCta({ label, busy = false, done = false, disabled = false, secondary = false, icon = "forward", className, onClick, type = "submit", ...rest }: {
  label: ReactNode; busy?: boolean; done?: boolean; disabled?: boolean; secondary?: boolean; icon?: Parameters<typeof Icon>[0]["name"];
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled">) {
  const ref = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useIso(() => {
    if (busy && ref.current) setWidth(ref.current.getBoundingClientRect().width);
    if (!busy) setWidth(null);
  }, [busy]);
  const blocked = busy || done || disabled;
  return (
    <button ref={ref} type={type} {...rest} data-stagger=""
      className={cx("mz-auth-cta", secondary && "mz-auth-cta--secondary", className)}
      aria-disabled={blocked || undefined} aria-busy={busy || undefined} data-done={done ? "" : undefined}
      style={width ? { minInlineSize: width } : undefined}
      onClick={(e) => {
        if (blocked) { e.preventDefault(); if (!busy && !done) onClick?.(e); return; }
        onClick?.(e);
      }}>
      <span className="mz-auth-cta__label">{label}</span>
      <span className="mz-auth-cta__key" aria-hidden="true">
        {busy ? <AuthProgress kind="sending" /> : done ? <AuthProgress kind="confirmed" /> : <Icon name={icon} size={16} />}
      </span>
    </button>
  );
}

/** A check that draws itself (CTA success, confirmed email). */
export function CheckDraw({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path className="mz-draw" style={{ ["--au-len" as string]: 24 }} d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/* ───────────── Alerts ───────────── */

/**
 * A form-level alert directly above the primary: role=alert, focusable, and focused when it
 * appears (`focusOnShow`). Re-key it (`alertKey`) to announce the same error again.
 */
export function FormAlert({ tone = "danger", children, action, onDismiss, dismissLabel, focusOnShow = true, alertKey, testId }: {
  tone?: "danger" | "info" | "success" | "warning"; children: ReactNode; action?: ReactNode; onDismiss?(): void; dismissLabel?: string;
  focusOnShow?: boolean; alertKey?: string | number; testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focusOnShow && tone === "danger") ref.current?.focus({ preventScroll: true }); }, [alertKey, focusOnShow, tone]);
  const role = tone === "danger" ? "alert" : "status";
  return (
    <div ref={ref} key={alertKey} className="mz-auth-alert" data-tone={tone} role={role} tabIndex={-1} data-testid={testId}>
      <Icon name={tone === "danger" ? "error" : tone === "success" ? "success" : tone === "warning" ? "warning" : "info"} size={16} />
      <div className="mz-auth-alert__body">
        <span>{children}</span>
        {action}
      </div>
      {onDismiss ? (
        <button type="button" className="mz-auth-alert__dismiss" onClick={onDismiss} aria-label={dismissLabel}><Icon name="close" size={16} /></button>
      ) : null}
    </div>
  );
}

/* ───────────── The one motion slot for waiting and confirming ───────────── */

export type ProgressKind = "loading" | "sending" | "confirmed";

/**
 * Every loading, sending-a-code and confirmed moment of the auth flow draws through this one
 * component, so the brand's fluid loaders (Brand 2.0, lane BR-1) can replace them in one place:
 * `loading` (the scale rocks: the session, a route), `sending` (a 16px arc in the busy button),
 * `confirmed` (a check that draws, or the shield, or the scale settling). Decorative: the words
 * next to it carry the state; pass `label` only where it stands alone (it becomes role=status).
 * Under reduced motion each is a still mark (css/auth.css).
 */
export function AuthProgress({ kind, size, mark = "check", label }: { kind: ProgressKind; size?: number; mark?: "check" | "shield" | "scale"; label?: string }) {
  const art = kind === "loading" ? <ScaleMark size={size ?? 48} mode="rock" />
    : kind === "sending" ? <i className="mz-auth-spin" style={size ? { inlineSize: size, blockSize: size } : undefined} />
    : mark === "scale" ? <ScaleMark size={size ?? 64} mode="settle" />
    : mark === "shield" ? (
      <span className="mz-auth-tile">
        <svg width={size ?? 24} height={size ?? 24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path className="mz-draw" style={{ ["--au-len" as string]: 60 }} d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
          <path className="mz-draw" style={{ ["--au-len" as string]: 14, animationDelay: "300ms" }} d="M9 12l2 2 4-4" />
        </svg>
      </span>
    ) : size && size > 16 ? <span className="mz-auth-tile"><CheckDraw size={size} /></span> : <CheckDraw size={size ?? 16} />;
  return label
    ? <span className="mz-auth-progress-slot" data-kind={kind} role="status"><span aria-hidden="true">{art}</span><span className="au-sr">{label}</span></span>
    : <span className="mz-auth-progress-slot" data-kind={kind} aria-hidden="true">{art}</span>;
}

/**
 * The new password's strength: four segments and a word, updated after 300ms of quiet or on blur
 * (never per keystroke). Ink fills, never red. `id` is what the input's aria-describedby points to.
 */
export function StrengthMeter({ id, score, label }: { id: string; score: number; label: ReactNode }) {
  return (
    <div className="mz-auth-meter" data-score={score}>
      <span className="mz-auth-meter__bars" aria-hidden="true">
        {[1, 2, 3, 4].map((i) => <i key={i} data-on={i <= score ? "" : undefined} />)}
      </span>
      <span id={id} className="mz-auth-roll"><span key={String(label)} data-in="">{label}</span></span>
    </div>
  );
}

/** "Step 1 of 2" as words and a bar (role=progressbar). */
export function StepProgress({ at, total, text }: { at: number; total: number; text: string }) {
  return (
    <div className="mz-auth-progress">
      <span>{text}</span>
      <span className="mz-auth-progress__bar" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={at} aria-valuetext={text}>
        <i style={{ transform: `scaleX(${at / total})` }} />
      </span>
    </div>
  );
}

/* ───────────── Marks ───────────── */

/** Mizan's scale: the beam and the two pans on their own pivots (settles once, or rocks while loading). */
export function ScaleMark({ size = 48, mode = "still", className }: { size?: number; mode?: "still" | "settle" | "rock"; className?: string }) {
  return (
    <svg className={cx("mz-auth-scale", className)} width={size} height={size} viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2.4"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-settle={mode === "settle" ? "" : undefined} data-rock={mode === "rock" ? "" : undefined}>
      <path d="M32 10v44M22 54h20" />
      <circle cx="32" cy="10" r="2.6" fill="currentColor" stroke="none" />
      <g className="au-beam">
        <path d="M12 18h40" />
        <g className="au-pan"><path d="M12 18l-7 15h14z" /><path d="M5 33a7 4 0 0 0 14 0" /></g>
        <g className="au-pan"><path d="M52 18l-7 15h14z" /><path d="M45 33a7 4 0 0 0 14 0" /></g>
      </g>
    </svg>
  );
}

/** A finished moment: check, shield or the scale, a heading and one line. role=status with an h1. */
export function SuccessMark({ title, text, variant = "scale", children }: { title: string; text?: ReactNode; variant?: "check" | "shield" | "scale"; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { revealWords(ref.current?.querySelector("h1") ?? null, 200); }, []);
  return (
    <div ref={ref} className="mz-auth-success" role="status" data-testid="auth-success">
      <AuthProgress kind="confirmed" mark={variant} size={variant === "scale" ? 64 : 22} />
      <h1 className="mz-auth-h1" tabIndex={-1}><Words text={title} /></h1>
      {text ? <p className="mz-auth-sub">{text}</p> : null}
      {children}
    </div>
  );
}

/** The card's placeholder while a route or the session loads: shown only after 300ms. */
export function CardSkeleton({ label, delay = 300 }: { label?: string; delay?: number }) {
  const [shown, setShown] = useState(false);
  useEffect(() => { const t = window.setTimeout(() => setShown(true), delay); return () => window.clearTimeout(t); }, [delay]);
  if (!shown) return null;
  return (
    <div className="mz-auth-skel" role="status" aria-label={label}>
      <i /><i /><i /><i />
    </div>
  );
}

/** Children's count, for callers that stagger lists (cap 8). */
export function countChildren(children: ReactNode): number {
  return Children.toArray(children).filter(isValidElement).length;
}

/** Fades an element in place (used for alerts that replace each other). */
export function useFadeIn<T extends HTMLElement>(dep: unknown): Ref<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    interrupt(el);
    run(el, [{ opacity: 0 }, { opacity: 1 }], { duration: prefersReducedMotion() ? 120 : ms("base", el), easing: "linear" });
  }, [dep]);
  return ref;
}
