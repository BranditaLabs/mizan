"use client";

import {
  AuthProgress, CodeField, FormAlert, PasswordField, PrimaryCta, ResendTimer, StepProgress, StrengthMeter, TextField,
} from "@mizan/design-system/auth/react";
import type { PhoneCountry } from "@mizan/shared";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { EmailField, OfflineBanner, PhoneField, ReasonBanner, TrialChip } from "./fields";

/**
 * The auth kit in the UI gallery (/ui#auth): every piece of the sign-in card in the current
 * language and theme, inside `.mz-auth` so the auth stylesheet and its motion tokens apply.
 * The one motion slot (AuthProgress), one labelled sample per meaning, on the Brand 2.0 loaders:
 * loading, signing in and checking a code (pair), sending a code or a link (transfer), creating
 * and saving (drop), confirmed (DoneState, small and with its copy).
 */
const WAITS = ["loading", "signingIn", "checking", "sending", "creating", "saving"] as const;
export function AuthGallery() {
  const t = useTranslations("auth");
  const tt = useTranslations("twoStep");
  const tm = useTranslations("gallery.motion.meaning");
  const dir = useLocale() === "ar" ? "rtl" : "ltr";
  const [email, setEmail] = useState("ahmed@gmial.com");
  const [pw, setPw] = useState("Nile-Threads-26");
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [country, setCountry] = useState<PhoneCountry>("EG");
  const [busy, setBusy] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const card = "mz-auth-card flex flex-col gap-4";
  return (
    <div className="mz-auth" dir={dir} style={{ minHeight: 0, background: "transparent" }} data-testid="gallery-auth">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className={card}>
          <div className="mz-auth-card__surface" aria-hidden="true" />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" data-testid="auth-progress-kinds">
            {WAITS.map((k) => (
              <figure key={k} className="flex flex-col items-center gap-1.5" data-meaning={k}>
                {k === "loading"
                  ? <AuthProgress kind="loading" size={40} label={t("live.checking")} />
                  : <span className="mz-auth-cta" style={{ inlineSize: 64, justifyContent: "center", paddingInline: 0 }}><span className="mz-auth-cta__key"><AuthProgress kind={k} /></span></span>}
                <figcaption className="text-caption opacity-70">{tm(k)}</figcaption>
              </figure>
            ))}
            <figure className="flex flex-col items-center gap-1.5" data-meaning="confirmed">
              <AuthProgress kind="confirmed" size={24} />
              <figcaption className="text-caption opacity-70">{t("doneTitle")}</figcaption>
            </figure>
          </div>
          <TrialChip plan="growth" interval="year" onPlan={() => {}} />
          <ReasonBanner tone="info" onDismiss={() => {}}>{t("reason.expired")}</ReasonBanner>
          <OfflineBanner />
          <EmailField value={email} onChange={setEmail} />
          <PasswordField label={t("password")} value={pw} onChange={(e) => setPw(e.target.value)} showLabel={t("showChars")} hideLabel={t("hideChars")}
            capsLabel={t("capsLock")} hint={t("passwordHint")} helpTone={pw.length >= 8 ? "ok" : "hint"}
            below={<StrengthMeter id="gallery-strength" score={3} label={t("strength.label", { level: t("strength.strong") })} />} />
          <TextField label={t("emailLabel")} defaultValue="ahmed@store" dir="ltr" error={t("errors.invalidEmail")} />
          <PrimaryCta type="button" label={t("continue")} busy={busy} busyAs="signingIn" onClick={() => { setBusy(true); window.setTimeout(() => setBusy(false), 1600); }} />
          <PrimaryCta type="button" label={t("createSubmit")} done />
          <PrimaryCta type="button" label={t("createAccount")} secondary icon="add" />
        </div>
        <div className={card}>
          <div className="mz-auth-card__surface" aria-hidden="true" />
          <StepProgress at={1} total={2} text={tt("progress", { at: 1, total: 2 })} />
          <PhoneField value={phone} onChange={setPhone} country={country} onCountry={setCountry} hint={t("phoneHintSms")} />
          <CodeField label={t("codeLabel")} value={code} onChange={setCode} hint={t.rich("codeSent", { phone: "+20 100 123 4821", n: (c) => <bdi dir="ltr">{c}</bdi> })} />
          <ResendTimer seconds={60} startedAt={startedAt} resendLabel={t("resend")} onResend={() => {}} countdown={(time) => t.rich("resendIn", { time: "", n: () => time })} />
          {/* A resend on its way: the inline TRANSFER on the link. */}
          <ResendTimer seconds={0} startedAt={0} busy resendLabel={t("resend")} onResend={() => {}} countdown={(time) => time} />
          <FormAlert focusOnShow={false}>{t("errors.invalidCode")}</FormAlert>
          {/* The success mark without its h1 (the gallery has one heading of level 1). */}
          <div className="mz-auth-success"><AuthProgress kind="confirmed" label={t("doneTitle")} size={96}><p className="mz-auth-sub">{t("doneTitle")}{" · "}{t("opening")}</p></AuthProgress></div>
        </div>
      </div>
    </div>
  );
}
