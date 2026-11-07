"use client";

import {
  AuthProgress, CodeField, FormAlert, PasswordField, PrimaryCta, ResendTimer, StepProgress, StrengthMeter, TextField,
} from "@mizan/design-system/auth/react";
import { FluidMark, type FluidBeat } from "@mizan/design-system/react/motion";
import type { PhoneCountry } from "@mizan/shared";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { EmailField, OfflineBanner, PhoneField, ReasonBanner, TrialChip } from "./fields";

/**
 * The auth kit in the UI gallery (/ui#auth): every piece of the sign-in card in the current
 * language and theme, inside `.mz-auth` so the auth stylesheet and its motion tokens apply.
 * The one motion slot (AuthProgress) in its kinds, on the Brand 2.0 loaders: loading (pair),
 * sending in the key (drop), confirmed (DoneState, small and with its copy). And the auth stage's
 * mark (FluidMark) with the beats the stage plays: still by default, each beat once on a press
 * (signed in is the card's DROP, DoneState above, not a stage beat).
 */
export function AuthGallery() {
  const t = useTranslations("auth");
  const tt = useTranslations("twoStep");
  const dir = useLocale() === "ar" ? "rtl" : "ltr";
  const [email, setEmail] = useState("ahmed@gmial.com");
  const [pw, setPw] = useState("Nile-Threads-26");
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState<PhoneCountry>("EG");
  const [busy, setBusy] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const ts = useTranslations("authStage");
  const [beat, setBeat] = useState<{ beat: FluidBeat | null; key: number }>({ beat: null, key: 0 });
  const card = "mz-auth-card flex flex-col gap-4";
  return (
    <div className="mz-auth" dir={dir} style={{ minHeight: 0, background: "transparent" }} data-testid="gallery-auth">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className={card}>
          <div className="mz-auth-card__surface" aria-hidden="true" />
          <div className="flex items-center gap-6" data-testid="auth-progress-kinds">
            <AuthProgress kind="loading" size={40} label={t("live.checking")} />
            <span className="mz-auth-cta" style={{ inlineSize: 64, justifyContent: "center", paddingInline: 0 }}><span className="mz-auth-cta__key"><AuthProgress kind="sending" /></span></span>
            <AuthProgress kind="confirmed" size={24} />
          </div>
          <div className="flex flex-wrap items-center gap-3" data-testid="auth-stage-mark">
            {/* On ink, as on the stage (the auth tokens: --au-ink, --au-paper). */}
            <span className="inline-grid place-items-center p-4" style={{ background: "var(--au-ink)", color: "var(--au-paper)", borderRadius: 16 }} role="img" aria-label={ts("beats.label")}>
              <FluidMark beat={beat.beat} beatKey={beat.key} size={72} claim={false} />
            </span>
            {(["settle", "tip"] as const).map((b) => (
              <button key={b} type="button" className="mz-auth-btn" style={{ inlineSize: "auto", paddingInline: 14 }} onClick={() => setBeat((s) => ({ beat: b, key: s.key + 1 }))}>{ts(`beats.${b}`)}</button>
            ))}
          </div>
          <TrialChip plan="growth" interval="year" onPlan={() => {}} />
          <ReasonBanner tone="info" onDismiss={() => {}}>{t("reason.expired")}</ReasonBanner>
          <OfflineBanner />
          <EmailField value={email} onChange={setEmail} />
          <PasswordField label={t("password")} value={pw} onChange={(e) => setPw(e.target.value)} showLabel={t("showChars")} hideLabel={t("hideChars")}
            capsLabel={t("capsLock")} hint={t("passwordHint")} helpTone={pw.length >= 8 ? "ok" : "hint"}
            below={<StrengthMeter id="gallery-strength" score={3} label={t("strength.label", { level: t("strength.strong") })} />} />
          <TextField label={t("emailLabel")} defaultValue="ahmed@store" dir="ltr" error={t("errors.invalidEmail")} />
          <PrimaryCta type="button" label={t("continue")} busy={busy} onClick={() => { setBusy(true); window.setTimeout(() => setBusy(false), 1600); }} />
          <PrimaryCta type="button" label={t("createSubmit")} done />
          <PrimaryCta type="button" label={t("createAccount")} secondary icon="add" />
        </div>
        <div className={card}>
          <div className="mz-auth-card__surface" aria-hidden="true" />
          <StepProgress at={1} total={2} text={tt("progress", { at: 1, total: 2 })} />
          <PhoneField value={phone} onChange={setPhone} country={country} onCountry={setCountry} hint={t("phoneHintSms")} />
          <CodeField label={t("codeLabel")} value={code} onChange={setCode} hint={t.rich("codeSent", { phone: "+20 100 123 4821", n: (c) => <bdi dir="ltr">{c}</bdi> })} />
          <ResendTimer seconds={60} startedAt={startedAt} resendLabel={t("resend")} onResend={() => {}} countdown={(time) => t.rich("resendIn", { time: "", n: () => time })} />
          <FormAlert focusOnShow={false}>{t("errors.invalidCode")}</FormAlert>
          {/* The success mark without its h1 (the gallery has one heading of level 1). */}
          <div className="mz-auth-success"><AuthProgress kind="confirmed" label={t("doneTitle")} size={96}><p className="mz-auth-sub">{t("doneTitle")}{" · "}{t("opening")}</p></AuthProgress></div>
        </div>
      </div>
    </div>
  );
}
