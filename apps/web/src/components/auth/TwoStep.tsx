"use client";

import { normalizePhone } from "@mizan/shared";
import { multiFactor, PhoneAuthProvider, PhoneMultiFactorGenerator, sendEmailVerification } from "firebase/auth";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { AuthHeading, CodeField, Step } from "./kit";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { useRouter } from "@/i18n/navigation";
import { authErrorCode, authErrorKey, type AuthErrorKey } from "@/lib/auth-errors";
import { firebaseAuth, smsVerifier } from "@/lib/firebase";
import { useSession } from "@/lib/session";

const RECAPTCHA = "sms-verifier";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthErrorKey | "recentLogin" | null>(null);

  const enrolled = user ? multiFactor(user).enrolledFactors.length > 0 : false;
  useEffect(() => {
    // Already enrolled: this session predates it; the gate needs a sign-in with the code.
    if (enrolled) router.replace("/");
  }, [enrolled, router]);

  if (!user || !auth) return null;
  const hasPassword = user.providerData.some((p) => p.providerId === "password");

  const signOutAndBack = (enrolledNow: boolean) => signOut(enrolledNow ? "/sign-in?enrolled=1" : "/sign-in");

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(authErrorCode(e) === "auth/requires-recent-login" ? "recentLogin" : authErrorKey(e));
    } finally {
      setBusy(false);
    }
  }

  const errorAlert = error ? (
    <Alert tone="danger">{error === "recentLogin" ? t("recentLogin") : te(`errors.${error}`)}</Alert>
  ) : null;

  if (!hasPassword) {
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
        <Button size="lg" variant={linkSent ? "secondary" : "primary"} busy={busy && !linkSent}
          onClick={() => void run(async () => { auth.languageCode = locale; await sendEmailVerification(user); setLinkSent(true); })}>
          {t("verifyEmail.send")}
        </Button>
        {linkSent ? (
          <Button size="lg" busy={busy} onClick={() => void run(async () => {
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
    void run(async () => {
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
    void run(async () => {
      await multiFactor(user).enroll(PhoneMultiFactorGenerator.assertion(PhoneAuthProvider.credential(verificationId, code.trim())));
      await signOutAndBack(true);
    });
  };

  return (
    <Step key="phone">
      <AuthHeading title={t("title")} body={t("body")} />
      <StepCount at={2} />
      <h2 className="text-heading-sm">{t("phone.title")}</h2>
      {verificationId ? (
        <form onSubmit={onEnable} className="flex flex-col gap-4" noValidate>
          <CodeField label={te("code")} hint={te.rich("codeHint", { phone: phone.trim(), n: (c) => <Bdi code>{c}</Bdi> })} value={code} onChange={setCode} />
          {errorAlert}
          <Button type="submit" size="lg" busy={busy}>{t("phone.enable")}</Button>
          <Button variant="ghost" onClick={() => { setVerificationId(null); setError(null); }}>{te("changeNumber")}</Button>
        </form>
      ) : (
        <form onSubmit={onSend} className="flex flex-col gap-4" noValidate>
          <Field label={te("phone")} hint={te.rich("phoneHint", { n: (c) => <Bdi code>{c}</Bdi> })} type="tel" ltr autoComplete="tel"
            inputMode="tel" required name="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          {errorAlert}
          <Button type="submit" size="lg" busy={busy}>{t("phone.submit")}</Button>
        </form>
      )}
      {error === "recentLogin" ? <Button variant="secondary" onClick={() => void signOutAndBack(false)}>{t("signOutAndBack")}</Button> : null}
      <div id={RECAPTCHA} />
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
