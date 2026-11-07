"use client";

import { AuthProgress, FormAlert, ResendTimer, TextField } from "@mizan/design-system/auth/react";
import { mmss } from "@mizan/design-system/auth-code";
import { Icon } from "@mizan/design-system/icons/react";
import { RedSwatch } from "@mizan/design-system/react/motion";
import type { PhoneCountry } from "@mizan/shared";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import { Segmented } from "@/components/ui/Choice";
import { TRIAL_DAYS } from "@/lib/auth/intent";
import type { Interval, Plan } from "@/lib/auth/params";
import { emailSuggestion, PHONE_DIAL, PHONE_PLACEHOLDER, phoneFromPaste } from "@/lib/auth/validate";
import { latin } from "@/lib/rich";
import { announce } from "@mizan/design-system/auth/react";

/**
 * The dashboard's pieces of the auth card, on top of the shared kit (packages/design-system
 * react/auth.tsx): the work-email field with its typo hint, the phone field with its country
 * picker, the trial chip, the reason and offline banners, the reCAPTCHA note, Google's button and
 * the identity chip. Every word comes from next-intl; numbers, phones and emails sit in <bdi>.
 */

export const bdi = (c: ReactNode) => <bdi dir="ltr">{c}</bdi>;
export const strongBdi = (c: ReactNode) => <bdi><strong>{c}</strong></bdi>;

/* ───────────── Email ───────────── */

/** A work email: left to right, no capitals or spell check; on blur, a typo in a common domain is offered as a fix. */
export function EmailField({ value, onChange, onBlur, error, autoComplete = "username", inputRef, readOnly, label }: {
  value: string; onChange(v: string): void; onBlur?(v: string): void; error?: ReactNode; autoComplete?: "username" | "email";
  inputRef?: Ref<HTMLInputElement>; readOnly?: boolean; label?: string;
}) {
  const t = useTranslations("auth");
  const [suggest, setSuggest] = useState<string | null>(null);
  return (
    <TextField label={label ?? t("emailLabel")} type="email" name="email" inputMode="email" autoCapitalize="none" spellCheck={false} dir="ltr"
      enterKeyHint="next" autoComplete={autoComplete} required aria-required="true" placeholder={t("emailPlaceholder")} inputRef={inputRef} readOnly={readOnly}
      value={value} onChange={(e) => { onChange(e.target.value); if (suggest) setSuggest(null); }}
      onBlur={(e) => {
        const v = e.target.value.trim();
        if (v !== e.target.value) onChange(v);
        setSuggest(emailSuggestion(v));
        onBlur?.(v);
      }}
      error={error}
      hint={suggest && !error ? (
        <span>
          {t.rich("emailTypo", { suggestion: suggest, n: bdi })}{" "}
          <button type="button" onClick={() => { onChange(suggest); setSuggest(null); }}>{t("emailTypoFix")}</button>
        </span>
      ) : undefined} />
  );
}

/* ───────────── Phone ───────────── */

const COUNTRIES: PhoneCountry[] = ["EG", "SA", "AE"];

/** A 20×14 flag drawn inline (no emoji: Windows does not draw flag emoji). */
export function Flag({ country }: { country: PhoneCountry }) {
  if (country === "EG") {
    return (
      <svg className="au-flag" viewBox="0 0 20 14" aria-hidden="true">
        <rect width="20" height="4.67" fill="#CE1126" /><rect y="4.67" width="20" height="4.67" fill="#fff" /><rect y="9.33" width="20" height="4.67" fill="#000" />
        <circle cx="10" cy="7" r="1.3" fill="#C09300" />
      </svg>
    );
  }
  if (country === "SA") {
    return (
      <svg className="au-flag" viewBox="0 0 20 14" aria-hidden="true">
        <rect width="20" height="14" fill="#006C35" /><rect x="5" y="5" width="10" height="1.4" rx=".7" fill="#fff" /><rect x="6" y="9" width="8" height=".9" fill="#fff" />
      </svg>
    );
  }
  return (
    <svg className="au-flag" viewBox="0 0 20 14" aria-hidden="true">
      <rect width="20" height="4.67" fill="#00732F" /><rect y="4.67" width="20" height="4.67" fill="#fff" /><rect y="9.33" width="20" height="4.67" fill="#000" />
      <rect width="5.5" height="14" fill="#FF0000" />
    </svg>
  );
}

/**
 * The phone number: [country][number], always left to right so the dial code sits on the left in
 * both languages. The country is a listbox button (arrow keys, typeahead, Escape back to the
 * button). A pasted or autofilled "+966 50 …" switches the country and keeps the rest. Nothing is
 * reformatted while typing; the caller regroups on blur.
 */
export function PhoneField({ value, onChange, country, onCountry, error, hint, inputRef, readOnly, onBlur }: {
  value: string; onChange(v: string): void; country: PhoneCountry; onCountry(c: PhoneCountry): void; error?: ReactNode; hint?: ReactNode;
  inputRef?: Ref<HTMLInputElement>; readOnly?: boolean; onBlur?(): void;
}) {
  const t = useTranslations("auth");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const typed = useRef({ at: 0, text: "" });
  const helpId = `ph${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  useEffect(() => {
    if (!open) return;
    list.current?.focus();
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const choose = (c: PhoneCountry) => { onCountry(c); setOpen(false); button.current?.focus(); };
  const onListKey = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const n = COUNTRIES.length;
    if (e.key === "Escape") { e.preventDefault(); setOpen(false); button.current?.focus(); return; }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(COUNTRIES[active]!); return; }
    if (e.key === "Tab") { setOpen(false); return; }
    const to = e.key === "ArrowDown" ? (active + 1) % n : e.key === "ArrowUp" ? (active - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (to !== null) { e.preventDefault(); setActive(to); return; }
    if (e.key.length === 1) {
      const now = e.timeStamp;
      typed.current = { at: now, text: (now - typed.current.at < 700 ? typed.current.text : "") + e.key.toLowerCase() };
      const i = COUNTRIES.findIndex((c) => t(`countries.${c}`).toLowerCase().startsWith(typed.current.text) || PHONE_DIAL[c].startsWith(typed.current.text));
      if (i >= 0) setActive(i);
    }
  };

  return (
    <div className="mz-auth-field" data-stagger="">
      <span className="mz-auth-label"><label htmlFor={`${helpId}-in`}>{t("phoneLabel")}</label></span>
      <div ref={box} className="mz-auth-phone mz-auth-pop" dir="ltr">
        <button ref={button} type="button" className="mz-auth-country" data-testid="phone-country" aria-haspopup="listbox" aria-expanded={open}
          aria-label={t.markup("countryValue", { country: t(`countries.${country}`), dial: PHONE_DIAL[country], n: (c) => c })}
          onClick={() => { setActive(COUNTRIES.indexOf(country)); setOpen((o) => !o); }}
          onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setActive(COUNTRIES.indexOf(country)); setOpen(true); } }}>
          <Flag country={country} />
          <bdi dir="ltr">+{PHONE_DIAL[country]}</bdi>
          <Icon name="chevron-down" size={14} />
        </button>
        <div className={`mz-auth-control`} data-invalid={error ? "" : undefined}>
          <input ref={inputRef} id={`${helpId}-in`} className="mz-auth-input" type="tel" inputMode="tel" autoComplete="tel" name="phone" enterKeyHint="send" dir="ltr"
            required aria-required="true" aria-invalid={error ? true : undefined} aria-describedby={`${helpId}-help`} placeholder={PHONE_PLACEHOLDER[country]}
            readOnly={readOnly} value={value} onBlur={onBlur}
            onChange={(e) => {
              const v = e.target.value;
              if (v.length - value.length > 3) {
                const p = phoneFromPaste(v);
                if (p) {
                  if (p.country !== country) { onCountry(p.country); announce(t("countryChanged", { country: t(`countries.${p.country}`) })); }
                  onChange(p.rest);
                  return;
                }
              }
              onChange(v);
            }} />
        </div>
        {open ? (
          <ul ref={list} role="listbox" tabIndex={-1} aria-label={t("countryPicker")} className="mz-auth-menu" onKeyDown={onListKey}
            aria-activedescendant={`${helpId}-c-${COUNTRIES[active]}`}>
            {COUNTRIES.map((c, i) => (
              <li key={c} id={`${helpId}-c-${c}`} role="option" aria-selected={c === country} data-active={i === active ? "" : undefined}
                className="mz-auth-menu__item" onClick={() => choose(c)} onPointerEnter={() => setActive(i)}>
                <Flag country={c} />
                <span dir="auto">{t(`countries.${c}`)}</span>
                <bdi dir="ltr" className="text-text-2">+{PHONE_DIAL[c]}</bdi>
                <Icon name="confirm" size={16} className="au-check" />
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {/* Not a live region (as Help): read through aria-describedby when focus moves to the field. */}
      <div id={`${helpId}-help`} className="mz-auth-help" data-tone={error ? "error" : "hint"}>
        {error ? <span className="au-roll"><Icon name="error" size={14} /><span>{error}</span></span> : hint ? <span><span>{hint}</span></span> : null}
      </div>
    </div>
  );
}

/* ───────────── Trial chip ───────────── */

/**
 * "[● 7 days] 7-day trial of Growth · then yearly": the plan the pricing page chose (from the URL,
 * allow-listed), with a note on what the trial means and a small "Change" between Growth and Scale.
 * Renders nothing when there is no trial. The red dot is decorative; the words carry the meaning.
 * "Change" opens a labelled choice: arrow keys move the selection without closing it; a click,
 * Enter or Space picks and closes. Escape and every close return focus to the button that opened it.
 */
export function TrialChip({ plan, interval, enterprise = false, onPlan }: { plan: Plan; interval: Interval; enterprise?: boolean; onPlan?(p: Plan): void }) {
  const t = useTranslations("auth");
  const [pop, setPop] = useState<"note" | "change" | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const infoBtn = useRef<HTMLButtonElement>(null);
  const changeBtn = useRef<HTMLButtonElement>(null);
  const close = () => {
    const from = pop;
    setPop(null);
    (from === "change" ? changeBtn : infoBtn).current?.focus();
  };
  useEffect(() => {
    if (!pop) return;
    // The choice opens on the plan in force, so the arrows start from it.
    if (pop === "change") box.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setPop(null); };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPop(null);
      (pop === "change" ? changeBtn : infoBtn).current?.focus();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [pop]);
  if (!TRIAL_DAYS) return null;
  const days = { days: TRIAL_DAYS, n: String(TRIAL_DAYS), b: strongBdi, ...latin };
  return (
    <div ref={box} className="mz-auth-pop" data-testid="trial-chip" style={{ alignSelf: "flex-start" }}>
      <span className="mz-auth-trial">
        {/* The trial dot takes its turn in the view's red budget (the header wordmark turns mono meanwhile). */}
        <RedSwatch claim="auth-trial" className="mz-auth-trial__dot" />
        <span>
          {enterprise ? t.rich("trial.enterprise", days) : t.rich("trial.chip", { ...days, plan: t(`plans.${plan}`) })}
          {interval === "year" ? <> · {t("trial.yearly")}</> : null}
        </span>
        <button ref={infoBtn} type="button" className="mz-auth-trial__more" aria-expanded={pop === "note"} aria-label={t("trial.info")} onClick={() => setPop(pop === "note" ? null : "note")}>
          <Icon name="info" size={14} />
        </button>
        {onPlan && !enterprise ? (
          <button ref={changeBtn} type="button" className="mz-auth-trial__more" style={{ inlineSize: "auto", paddingInline: 8 }} aria-expanded={pop === "change"} onClick={() => setPop(pop === "change" ? null : "change")}>
            {t("trial.change")}
          </button>
        ) : null}
      </span>
      {pop === "note" ? <p className="mz-auth-menu mz-auth-trial__note" data-align="start" role="note">{t("trial.note")}</p> : null}
      {pop === "change" && onPlan ? (
        // A click (Enter and Space click too) on a plan picks and closes; arrow keys only move the selection.
        <div className="mz-auth-menu mz-auth-trial__pick" data-align="start"
          onClick={(e) => { if ((e.target as Element).closest('[role="radio"]')) close(); }}>
          {/* The visible line; the radiogroup carries the same words as its name. */}
          <span className="mz-auth-trial__picklabel" aria-hidden="true">{t("trial.pickLabel")}</span>
          <Segmented label={t("trial.pickLabel")} value={plan} options={(["growth", "scale"] as const).map((p) => ({ value: p, label: <bdi>{t(`plans.${p}`)}</bdi> }))}
            onChange={(p) => onPlan(p)} />
        </div>
      ) : null}
    </div>
  );
}

/* ───────────── Banners and notes ───────────── */

/** Why the person is here (session ended, password changed, invited …): status, dismissible. */
export function ReasonBanner({ tone, children, onDismiss }: { tone: "info" | "success" | "danger"; children: ReactNode; onDismiss(): void }) {
  const t = useTranslations("frame");
  return (
    <div className="mz-auth-alert" data-tone={tone === "danger" ? "warning" : tone} role="status" data-testid="auth-reason" data-stagger="">
      <Icon name={tone === "success" ? "success" : tone === "danger" ? "warning" : "info"} size={16} />
      <div className="mz-auth-alert__body"><span>{children}</span></div>
      <button type="button" className="mz-auth-alert__dismiss" onClick={onDismiss} aria-label={t("dismiss")}><Icon name="close" size={16} /></button>
    </div>
  );
}

/** The connection dropped: nothing is sent until it is back, and nothing is resubmitted then. */
export function OfflineBanner() {
  const t = useTranslations("frame");
  return (
    <div className="mz-auth-alert" data-tone="warning" role="status" data-testid="offline-banner">
      <Icon name="offline" size={16} />
      <div className="mz-auth-alert__body"><span>{t("offline")}</span></div>
    </div>
  );
}

/** Under every button that sends an SMS: the reCAPTCHA attribution (its badge is hidden, as Google allows with this text). */
export function RecaptchaNote() {
  const t = useTranslations("frame");
  return (
    <p className="mz-auth-note" data-stagger="">
      {t.rich("recaptcha", {
        ...latin,
        privacy: (c) => <a href="https://policies.google.com/privacy" rel="noopener noreferrer" target="_blank">{c}</a>,
        terms: (c) => <a href="https://policies.google.com/terms" rel="noopener noreferrer" target="_blank">{c}</a>,
      })}
    </p>
  );
}

/** Who the code went to, with "Change" (back to the number). */
export function IdentityChip({ value, changeLabel, onChange }: { value: string; changeLabel: string; onChange(): void }) {
  return (
    <span className="mz-auth-chip" data-stagger="">
      <bdi dir="ltr">{value}</bdi>
      <button type="button" onClick={onChange}>{changeLabel}</button>
    </span>
  );
}

/** "Send again in 0:59", then "Send again" (links: reset and verification, 60s). */
export function LinkResend({ startedAt, onResend, busy }: { startedAt: number; onResend(): void; busy?: boolean }) {
  const t = useTranslations("auth");
  return (
    <ResendTimer seconds={60} startedAt={startedAt} resendLabel={t("resendLink")} readyMessage={t("live.resendReady")} busy={busy} onResend={onResend}
      countdown={(time) => t.rich("resendLinkIn", { time: "", n: () => time })} />
  );
}

/**
 * The API is not answering: the card says so and tries again by itself (2, 4, 8, 16, then every 30s).
 * While a try is out (`busy`: pressed or automatic) the button waits for the answer with a PAIR
 * (AuthProgress `loading`), cannot be pressed again, and the countdown holds.
 */
export function OutageCard({ attempt, onRetry, busy = false }: { attempt: number; onRetry(): void; busy?: boolean }) {
  const t = useTranslations("gate");
  const wait = [2, 4, 8, 16][attempt] ?? 30;
  // Keyed by attempt in the caller: each attempt starts its own countdown.
  const [left, setLeft] = useState(wait);
  useEffect(() => {
    if (busy) return;
    if (left <= 0) { onRetry(); return; }
    const id = window.setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => window.clearTimeout(id);
  }, [left, onRetry, busy]);
  return (
    <div className="mz-auth-step" data-testid="auth-outage">
      <div className="mz-auth-head">
        <span className="mz-auth-tile" aria-hidden="true"><Icon name="offline" size={20} /></span>
        <h1 className="mz-auth-h1" tabIndex={-1}>{t("outage.title")}</h1>
        <p className="mz-auth-sub"><span aria-live="off">{t.rich("outage.body", { time: mmss(left), n: bdi })}</span></p>
      </div>
      <button type="button" className="mz-auth-btn" aria-disabled={busy || undefined} aria-busy={busy || undefined} data-testid="auth-outage-retry"
        onClick={busy ? undefined : onRetry}>
        {busy ? <AuthProgress kind="loading" size={20} /> : null}
        {t("outage.now")}
      </button>
    </div>
  );
}

export { FormAlert };

/** Google's "G", in its own colours as Google's sign-in branding asks; decorative next to the label. */
export function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
