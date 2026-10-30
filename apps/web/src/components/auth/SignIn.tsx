"use client";

import { normalizePhone } from "@mizan/shared";
import {
  createUserWithEmailAndPassword, getMultiFactorResolver, GoogleAuthProvider, PhoneAuthProvider, PhoneMultiFactorGenerator,
  sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPhoneNumber, signInWithPopup,
  type ConfirmationResult, type MultiFactorError, type MultiFactorResolver, type PhoneMultiFactorInfo,
} from "firebase/auth";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Choice";
import { Field } from "@/components/ui/Field";
import { useRouter } from "@/i18n/navigation";
import { authErrorCode, authErrorKey, type AuthErrorKey } from "@/lib/auth-errors";
import { firebaseAuth, smsVerifier } from "@/lib/firebase";
import { useSession } from "@/lib/session";
import { AuthHeading, CodeField, Done, PasswordField, Step } from "./kit";

const RECAPTCHA = "sms-verifier";
const CLOSED = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"]);

type Mfa = { resolver: MultiFactorResolver; verificationId: string; hint: string };
type StepName = "start" | "phoneCode" | "mfa" | "reset";

/**
 * Sign-in (E4-2), one step at a time. Start: Google, or email and password (or a new account), or a
 * phone number. Then the code we texted (phone sign-in), the SMS second step for accounts that turned
 * it on (owners and admins must: the API answers mfa_required otherwise), or a password reset link.
 * Each step slides in from the reading direction; once signed in, the store gate decides where to go.
 */
export function SignIn({ next, enrolled }: { next: string; enrolled: boolean }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const { status } = useSession();
  const auth = firebaseAuth();

  const [step, setStep] = useState<StepName>("start");
  const [method, setMethod] = useState<"email" | "phone">("email");
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [mfa, setMfa] = useState<Mfa | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthErrorKey | null>(null);
  const [resetSent, setResetSent] = useState(false);

  useEffect(() => {
    if (status === "signed-in") router.replace(next);
  }, [status, next, router]);

  if (!auth) return <Alert tone="warning">{t("notConfigured")}</Alert>;
  if (status === "signed-in") return <Done text={t("done")} />;

  const go = (s: StepName) => { setError(null); setCode(""); setStep(s); };

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (e) {
      setError(authErrorKey(e));
    } finally {
      setBusy(false);
    }
  }

  /** A first factor that needs the SMS second step (email or Google): send the code and ask for it. */
  async function secondStep(err: unknown) {
    if (!auth || authErrorCode(err) !== "auth/multi-factor-auth-required") throw err;
    const resolver = getMultiFactorResolver(auth, err as MultiFactorError);
    const hint = resolver.hints.find((h) => h.factorId === PhoneMultiFactorGenerator.FACTOR_ID) as PhoneMultiFactorInfo | undefined;
    if (!hint) throw err;
    const verificationId = await new PhoneAuthProvider(auth).verifyPhoneNumber({ multiFactorHint: hint, session: resolver.session }, smsVerifier(auth, RECAPTCHA));
    setMfa({ resolver, verificationId, hint: hint.phoneNumber.replace(/\D/g, "").slice(-4) });
    go("mfa");
  }

  const onEmail = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (creating) {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
        return;
      }
      try {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } catch (err) {
        await secondStep(err);
      }
    });
  };

  const onGoogle = () => {
    void run(async () => {
      auth.languageCode = locale;
      const google = new GoogleAuthProvider();
      google.setCustomParameters({ prompt: "select_account" });
      try {
        await signInWithPopup(auth, google);
      } catch (err) {
        if (CLOSED.has(authErrorCode(err))) return; // the person closed the window: nothing to say
        await secondStep(err);
      }
    });
  };

  const onPhone = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const p = normalizePhone(phone, "EG");
      if (!p) {
        setError("invalidPhone");
        return;
      }
      auth.languageCode = locale;
      setConfirmation(await signInWithPhoneNumber(auth, p.e164, smsVerifier(auth, RECAPTCHA)));
      go("phoneCode");
    });
  };

  const onPhoneCode = (e: FormEvent) => {
    e.preventDefault();
    if (!confirmation) return;
    void run(async () => { await confirmation.confirm(code.trim()); });
  };

  const onMfa = (e: FormEvent) => {
    e.preventDefault();
    if (!mfa) return;
    void run(async () => {
      await mfa.resolver.resolveSignIn(PhoneMultiFactorGenerator.assertion(PhoneAuthProvider.credential(mfa.verificationId, code.trim())));
    });
  };

  const onReset = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      auth.languageCode = locale;
      await sendPasswordResetEmail(auth, email.trim());
      setResetSent(true);
    });
  };

  const errorAlert = error ? <Alert tone="danger">{t(`errors.${error}`)}</Alert> : null;
  const emailField = (
    <Field label={t("email")} type="email" ltr autoComplete="email" required name="email" className="[&_input]:h-11"
      value={email} onChange={(e) => setEmail(e.target.value)} />
  );

  return (
    <div className="flex flex-col gap-5">
      {enrolled && step === "start" ? <Alert tone="success">{t("enrolled")}</Alert> : null}

      {step === "start" ? (
        <Step key="start">
          <AuthHeading title={creating ? t("createTitle") : t("title")} body={creating ? t("createSubtitle") : t("subtitle")} />
          <button type="button" onClick={onGoogle} disabled={busy}
            className="flex h-12 w-full items-center justify-center gap-3 rounded-md border border-line-strong bg-surface text-label text-text transition-[transform,background-color,border-color] duration-150 hover:border-text-3 hover:bg-surface-hover active:scale-[0.99] disabled:opacity-60">
            <GoogleMark />
            {t("google")}
          </button>
          <p className="text-center text-caption text-text-3">{t("or")}</p>
          <Segmented label={t("tabs.label")} value={method}
            options={(["email", "phone"] as const).map((m) => ({ value: m, label: t(`tabs.${m}`) }))}
            onChange={(m) => { setMethod(m); setError(null); }} />
          {method === "email" ? (
            <form key="email" onSubmit={onEmail} className="mz-step flex flex-col gap-4" noValidate>
              {emailField}
              <PasswordField label={t("password")} autoComplete={creating ? "new-password" : "current-password"} required name="password"
                hint={creating ? t("passwordHint") : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />
              {errorAlert}
              <Button type="submit" size="lg" busy={busy}>{creating ? t("createSubmit") : t("signIn")}</Button>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button variant="ghost" onClick={() => { setCreating(!creating); setError(null); }}>{creating ? t("haveAccount") : t("createAccount")}</Button>
                {creating ? null : <Button variant="ghost" onClick={() => { setResetSent(false); go("reset"); }}>{t("forgot")}</Button>}
              </div>
            </form>
          ) : (
            <form key="phone" onSubmit={onPhone} className="mz-step flex flex-col gap-4" noValidate>
              <Field label={t("phone")} type="tel" ltr autoComplete="tel" inputMode="tel" required name="phone" className="[&_input]:h-11"
                hint={t.rich("phoneHint", { n: (c) => <Bdi code>{c}</Bdi> })} value={phone} onChange={(e) => setPhone(e.target.value)} />
              {errorAlert}
              <Button type="submit" size="lg" busy={busy}>{t("sendCode")}</Button>
            </form>
          )}
        </Step>
      ) : null}

      {step === "phoneCode" ? (
        <Step key="phoneCode">
          <AuthHeading title={t("codeTitle")} body={t.rich("codeHint", { phone: phone.trim(), n: (c) => <Bdi code>{c}</Bdi> })} />
          <form onSubmit={onPhoneCode} className="flex flex-col gap-4" noValidate>
            <CodeField label={t("code")} value={code} onChange={setCode} />
            {errorAlert}
            <Button type="submit" size="lg" busy={busy}>{t("verify")}</Button>
            <Button variant="ghost" onClick={() => { setConfirmation(null); go("start"); }}>{t("changeNumber")}</Button>
          </form>
        </Step>
      ) : null}

      {step === "mfa" && mfa ? (
        <Step key="mfa">
          <AuthHeading title={t("mfa.title")} body={t.rich("mfa.body", { hint: mfa.hint, n: (c) => <Bdi code>{c}</Bdi> })} />
          <form onSubmit={onMfa} className="flex flex-col gap-4" noValidate>
            <CodeField label={t("code")} value={code} onChange={setCode} />
            {errorAlert}
            <Button type="submit" size="lg" busy={busy}>{t("mfa.submit")}</Button>
            <Button variant="ghost" onClick={() => { setMfa(null); go("start"); }}>{t("back")}</Button>
          </form>
        </Step>
      ) : null}

      {step === "reset" ? (
        <Step key="reset">
          <AuthHeading title={t("resetTitle")} body={t("resetBody")} />
          <form onSubmit={onReset} className="flex flex-col gap-4" noValidate>
            {emailField}
            {resetSent ? <Alert tone="success">{t.rich("resetSent", { email: email.trim(), e: (c) => <Bdi code>{c}</Bdi> })}</Alert> : null}
            {errorAlert}
            <Button type="submit" size="lg" busy={busy} disabled={!email.trim()}>{t("resetSend")}</Button>
            <Button variant="ghost" onClick={() => go("start")}>{t("backToSignIn")}</Button>
          </form>
        </Step>
      ) : null}

      <p className="text-caption text-text-3">{t("legal")}</p>
      <div id={RECAPTCHA} />
    </div>
  );
}

/** Google's "G", in its own colours as Google's sign-in branding asks; decorative next to the label. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
