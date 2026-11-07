"use client";

import { normalizePhone } from "@mizan/shared";
import { multiFactor, PhoneAuthProvider, PhoneMultiFactorGenerator, sendEmailVerification } from "firebase/auth";
import { useLocale, useTranslations } from "next-intl";
import { AuthProgress } from "@mizan/design-system/auth/react";
import { useEffect, useState, type FormEvent } from "react";
import { AuthHeading, CodeField, Step } from "./kit";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { useRouter } from "@/i18n/navigation";
import { authErrorCode, authErrorKey, type AuthErrorKey } from "@/lib/auth-errors";
import { firebaseAuth, smsVerifier } from "@/lib/firebase";
import { resume } from "@/lib/next-path";
import { useSession } from "@/lib/session";

/** The reCAPTCHA container lives in the persistent frame (Frame.tsx), outside every animated subtree. */
const RECAPTCHA = "sms-verifier";
/** How long "two-step is on" (DoneState) shows before signing in again with the code. */
const ENABLED_MS = 1400;
/** The press that is running (only that button animates). */
type BusyKey = "send" | "check" | "sms" | "enable";

/**
 * Turn on two-step verification (Firebase SMS second factor): owners and admins need it before the
 * API lets them into a store (mfa_required). Firebase enrols only a verified email, so that comes
 * first. After enrolment the person signs in again, this time with the code, which marks the token.
 */
export function TwoStep() {
  const t = useTranslations("twoStep");
  const te = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const { user, signOut } = useSession();
  const auth = firebaseAuth();

  const [verified, setVerified] = useState(Boolean(user?.emailVerified));
  const [linkSent, setLinkSent] = useState(false);
  const [notYet, setNotYet] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [busy, setBusy] = useState<BusyKey | null>(null);
  const [enabledNow, setEnabledNow] = useState(false);
  const [error, setError] = useState<AuthErrorKey | "recentLogin" | null>(null);

  const enrolled = user ? multiFactor(user).enrolledFactors.length > 0 : false;
  useEffect(() => {
    // Already enrolled: this session predates it; the gate needs a sign-in with the code.
    if (enrolled) router.replace(resume.take() ?? "/");
  }, [enrolled, router]);

  if (!user || !auth) return null;
  // Firebase enrols an SMS second step on any account with an email: password, Google (already
  // verified, so it goes straight to the phone) or company SSO. Only phone-number accounts have none.
  const hasEmail = Boolean(user.email);

  // Signing in again (with the code) comes back to where the detour started, a Shopify install included.
  const signOutAndBack = (enrolledNow: boolean) => {
    const back = resume.take();
    const next = back ? `next=${encodeURIComponent(back)}` : "";
    return signOut(enrolledNow ? `/sign-in?enrolled=1${next ? `&${next}` : ""}` : `/sign-in${next ? `?${next}` : ""}`);
  };

  async function run(key: BusyKey, work: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(authErrorCode(e) === "auth/requires-recent-login" ? "recentLogin" : authErrorKey(e));
    } finally {
      setBusy(null);
    }
  }

  const errorAlert = error ? (
    <Alert tone="danger">{error === "recentLogin" ? t("recentLogin") : te(`errors.${error}`)}</Alert>
  ) : null;

  if (!hasEmail) {
    return (
      <Step>
        <AuthHeading title={t("title")} />
        <Alert tone="warning">{t("phoneAccount")}</Alert>
        <Button variant="secondary" size="lg" onClick={() => void signOutAndBack(false)}>{t("signOutAndBack")}</Button>
      </Step>
    );
  }

  if (!verified) {
    return (
      <Step key="verify">
        <AuthHeading title={t("title")} body={t("body")} />
        <StepCount at={1} />
        <h2 className="text-heading-sm">{t("verifyEmail.title")}</h2>
        <p className="text-body-sm text-text-2">{t.rich("verifyEmail.body", { email: user.email ?? "", e: (c) => <Bdi code>{c}</Bdi> })}</p>
        {linkSent ? <Alert tone="success">{t("verifyEmail.sent")}</Alert> : null}
        {notYet ? <Alert tone="warning">{t("verifyEmail.notYet")}</Alert> : null}
        {errorAlert}
        {/* Sending the link out = TRANSFER; "I confirmed" waits for Firebase's answer = PAIR. */}
        <Button size="lg" variant={linkSent ? "secondary" : "primary"} busy={busy === "send"} as="sending" disabled={busy !== null && busy !== "send"}
          onClick={() => void run("send", async () => { auth.languageCode = locale; await sendEmailVerification(user); setLinkSent(true); })}>
          {t("verifyEmail.send")}
        </Button>
        {linkSent ? (
          <Button size="lg" busy={busy === "check"} as="checking" disabled={busy !== null && busy !== "check"} onClick={() => void run("check", async () => {
            await user.reload();
            await user.getIdToken(true);
            setNotYet(!user.emailVerified);
            setVerified(user.emailVerified);
          })}>{t("verifyEmail.done")}</Button>
        ) : null}
      </Step>
    );
  }

  const onSend = (e: FormEvent) => {
    e.preventDefault();
    void run("sms", async () => {
      const p = normalizePhone(phone, "EG");
      if (!p) {
        setError("invalidPhone");
        return;
      }
      auth.languageCode = locale;
      const session = await multiFactor(user).getSession();
      setCode("");
      setVerificationId(await new PhoneAuthProvider(auth).verifyPhoneNumber({ phoneNumber: p.e164, session }, smsVerifier(auth, RECAPTCHA)));
    });
  };

  const onEnable = (e: FormEvent) => {
    e.preventDefault();
    if (!verificationId) return;
    void run("enable", async () => {
      await multiFactor(user).enroll(PhoneMultiFactorGenerator.assertion(PhoneAuthProvider.credential(verificationId, code.trim())));
      // The outcome first (DoneState: two-step is on), then sign in again with the code.
      setEnabledNow(true);
      await new Promise((r) => window.setTimeout(r, ENABLED_MS));
      await signOutAndBack(true);
    });
  };

  if (enabledNow) {
    return (
      <Step key="enabled">
        <AuthProgress kind="confirmed" label={t("enabledTitle")} size={96}>
          <p className="text-body-sm text-text-2">{t("doneBody")}</p>
        </AuthProgress>
      </Step>
    );
  }

  return (
    <Step key="phone">
      <AuthHeading title={t("title")} body={t("body")} />
      <StepCount at={2} />
      <h2 className="text-heading-sm">{t("phone.title")}</h2>
      {verificationId ? (
        <form onSubmit={onEnable} className="flex flex-col gap-(--_gap)" noValidate>
          <CodeField label={te("code")} hint={te.rich("codeHint", { phone: phone.trim(), n: (c) => <Bdi code>{c}</Bdi> })} value={code} onChange={setCode} />
          {errorAlert}
          <Button type="submit" size="lg" busy={busy === "enable"} as="creating">{t("phone.enable")}</Button>
          <Button variant="ghost" onClick={() => { setVerificationId(null); setError(null); }}>{te("changeNumber")}</Button>
        </form>
      ) : (
        <form onSubmit={onSend} className="flex flex-col gap-(--_gap)" noValidate>
          <Field label={te("phone")} hint={te.rich("phoneHint", { n: (c) => <Bdi code>{c}</Bdi> })} type="tel" ltr autoComplete="tel"
            inputMode="tel" required name="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          {errorAlert}
          <Button type="submit" size="lg" busy={busy === "sms"} as="sending">{t("phone.submit")}</Button>
        </form>
      )}
      {error === "recentLogin" ? <Button variant="secondary" onClick={() => void signOutAndBack(false)}>{t("signOutAndBack")}</Button> : null}
    </Step>
  );
}

/** Where the person is in the two steps (email, then phone): a quiet line, not a numbered badge. */
function StepCount({ at }: { at: 1 | 2 }) {
  const t = useTranslations("twoStep");
  return (
    <div className="flex items-center gap-3" aria-label={t("progress", { at, total: 2 })}>
      {[1, 2].map((n) => <span key={n} className={`h-1 flex-1 rounded-full transition-colors duration-500 ${n <= at ? "bg-text" : "bg-line"}`} />)}
    </div>
  );
}
