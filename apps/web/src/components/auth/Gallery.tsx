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
 * The one motion slot (AuthProgress) is shown in its three kinds: Brand 2.0 replaces them there.
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
  const card = "mz-auth-card flex flex-col gap-4";
  return (
    <div className="mz-auth" dir={dir} style={{ minHeight: 0, background: "transparent" }} data-testid="gallery-auth">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className={card}>
          <div className="mz-auth-card__surface" aria-hidden="true" />
          <div className="flex items-center gap-6" data-testid="auth-progress-kinds">
            <AuthProgress kind="loading" size={40} label={t("live.checking")} />
            <span className="mz-auth-cta" style={{ inlineSize: 64, justifyContent: "center", paddingInline: 0 }}><span className="mz-auth-cta__key"><AuthProgress kind="sending" /></span></span>
            <AuthProgress kind="confirmed" size={22} />
            <AuthProgress kind="confirmed" mark="shield" />
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
          <div className="mz-auth-success"><AuthProgress kind="confirmed" mark="scale" /><p className="mz-auth-sub">{t("doneTitle")}{" · "}{t("opening")}</p></div>
        </div>
      </div>
    </div>
  );
}
