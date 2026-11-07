"use client";

import { resendWait } from "@mizan/design-system/auth-code";
import {
  announce, BackButton, CodeField, FormAlert, PasswordField, PrimaryCta, ResendTimer, StepHeader, StepHost, SuccessMark, TextField,
} from "@mizan/design-system/auth/react";
import {
  getMultiFactorResolver, PhoneAuthProvider, PhoneMultiFactorGenerator, signInWithEmailAndPassword,
  type MultiFactorError, type MultiFactorResolver, type PhoneMultiFactorInfo,
} from "firebase/auth";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";
import { authErrorCode, authErrorKey, type AuthErrorKey } from "@/lib/auth-errors";
import { staffStage } from "@/lib/auth-stage";
import { firebaseAuth, smsVerifier } from "@/lib/firebase";
import { safeNext } from "@/lib/next-path";
import { useSession } from "@/lib/session";

/** The reCAPTCHA container: a direct child of the staff frame (StaffFrame), outside the animated steps. */
const RECAPTCHA = "sms-verifier";
type Mfa = { resolver: MultiFactorResolver; verificationId: string; hint: string; phone: PhoneMultiFactorInfo };

/**
 * Staff sign-in (AU-1, auth spec §2.16) on the shared auth kit: the same Mizan account as the
 * dashboard, email and password, then the SMS code (with a resend). No Google, no SSO, no phone
 * sign-in. Labels stay "Email", "Password", "Code" and the buttons "Sign in", "Verify" (e2e).
 * Afterwards back to `?next` (a back-office path only). An account without a second factor is
 * refused by the API; the Shell says why.
 */
export function SignIn() {
  const t = useTranslations("auth");
  const router = useRouter();
  const { status } = useSession();
  const auth = firebaseAuth();
  const headingId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfa, setMfa] = useState<Mfa | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ key: AuthErrorKey; at: number } | null>(null);
  const [fieldError, setFieldError] = useState<{ email?: AuthErrorKey; password?: AuthErrorKey; code?: AuthErrorKey }>({});
  const [sends, setSends] = useState({ count: 0, at: 0, just: false });
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (status === "signed-in") staffStage.signal("signedIn");
  }, [status]);
  useEffect(() => {
    if (status === "signed-in") router.replace(safeNext(new URLSearchParams(window.location.search).get("next")));
  }, [status, router]);

  // A refused password: the field takes focus with its value selected, so retyping replaces it.
  useEffect(() => {
    if (error?.key !== "invalidCredential" || !passwordRef.current?.isConnected) return;
    passwordRef.current.focus({ preventScroll: true });
    passwordRef.current.select();
  }, [error?.key, error?.at]);

  if (!auth) return <FormAlert tone="warning" focusOnShow={false}>{t("notConfigured")}</FormAlert>;

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setFieldError({});
    try {
      await work();
    } catch (e) {
      setError({ key: authErrorKey(e), at: Date.now() });
      staffStage.signal("error");
    } finally {
      setBusy(false);
    }
  }

  const sendCode = async (resolver: MultiFactorResolver, hint: PhoneMultiFactorInfo) =>
    new PhoneAuthProvider(auth).verifyPhoneNumber({ multiFactorHint: hint, session: resolver.session }, smsVerifier(auth, RECAPTCHA));

  const onEmail = (e: FormEvent) => {
    e.preventDefault();
    const missing = { email: email.trim() ? undefined : "requiredEmail" as const, password: password ? undefined : "requiredPassword" as const };
    if (missing.email || missing.password) {
      setFieldError(missing);
      staffStage.signal("error");
      (missing.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    void run(async () => {
      try {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      } catch (err) {
        if (authErrorCode(err) !== "auth/multi-factor-auth-required") throw err;
        const resolver = getMultiFactorResolver(auth, err as MultiFactorError);
        const hint = resolver.hints.find((h) => h.factorId === PhoneMultiFactorGenerator.FACTOR_ID) as PhoneMultiFactorInfo | undefined;
        if (!hint) throw Object.assign(new Error("mfa"), { code: "auth/unsupported-first-factor" });
        const verificationId = await sendCode(resolver, hint);
        setCode("");
        setSends({ count: 1, at: Date.now(), just: false });
        setMfa({ resolver, verificationId, hint: hint.phoneNumber.replace(/\D/g, "").slice(-4), phone: hint });
      }
    });
  };

  const onMfa = (e: FormEvent) => {
    e.preventDefault();
    if (!mfa) return;
    if (code.length !== 6) { setFieldError({ code: "codeIncomplete" }); staffStage.signal("error"); return; }
    void run(async () => {
      await mfa.resolver.resolveSignIn(PhoneMultiFactorGenerator.assertion(PhoneAuthProvider.credential(mfa.verificationId, code)));
    });
  };

  const resend = () => void run(async () => {
    if (!mfa) return;
    const verificationId = await sendCode(mfa.resolver, mfa.phone);
    setMfa({ ...mfa, verificationId });
    setCode("");
    setSends((s) => ({ count: s.count + 1, at: Date.now(), just: true }));
    announce(t("codeResent"));
  });

  // A refused code or password puts focus in its field (value selected); role=alert still announces the message.
  const fieldTakesFocus = error?.key === "invalidCode" || error?.key === "invalidCredential";
  const alert = error ? <FormAlert alertKey={error.at} focusOnShow={!fieldTakesFocus}>{t(`errors.${error.key}`)}</FormAlert> : null;
  const n = (c: React.ReactNode) => <bdi dir="ltr">{c}</bdi>;
  const step = status === "signed-in" ? "done" : mfa ? "mfa" : "start";

  return (
    <StepHost stepKey={step} direction={step === "start" ? "back" : "forward"} focus={step === "mfa" ? "code" : step === "done" ? "heading" : "field"} className="mz-auth-stagger">
      {step === "done" ? (
        <SuccessMark title={t("doneTitle")} text={t("done")} />
      ) : step === "mfa" && mfa ? (
        <>
          <BackButton label={t("back")} onClick={() => { setMfa(null); setError(null); }} />
          <StepHeader id={headingId} icon="locked" title={t("mfa.title")} body={<span id={`${headingId}-sent`}>{t.rich("mfa.body", { hint: mfa.hint, n })}</span>} />
          <form onSubmit={onMfa} noValidate aria-labelledby={headingId} aria-busy={busy || undefined}>
            <CodeField label={t("code")} value={code} busy={busy} describedBy={`${headingId}-sent`} invalid={error?.key === "invalidCode"}
              // Each refusal is new (no auto-submit here): the field re-selects its value every time.
              rejected={error?.key === "invalidCode" ? `${error.at}` : null}
              error={fieldError.code ? t(`errors.${fieldError.code}`) : undefined}
              onChange={(v) => { setCode(v); setFieldError({}); }} />
            <ResendTimer seconds={resendWait(sends.count)} startedAt={sends.at} busy={busy} justSent={sends.just} sentLabel={t("sent")}
              resendLabel={t("resend")} readyMessage={t("resendReady")} onResend={resend} countdown={(time) => t.rich("resendIn", { time: "", n: () => time })} />
            {alert}
            <PrimaryCta label={t("mfa.submit")} busy={busy} icon="confirm" />
            <p className="mz-auth-note">
              {t.rich("recaptcha", {
                privacy: (c) => <a href="https://policies.google.com/privacy" rel="noopener noreferrer" target="_blank">{c}</a>,
                terms: (c) => <a href="https://policies.google.com/terms" rel="noopener noreferrer" target="_blank">{c}</a>,
              })}
            </p>
          </form>
        </>
      ) : (
        <>
          <StepHeader id={headingId} kicker={t("kicker")} title={t("title")} body={t("subtitle")} />
          <form onSubmit={onEmail} noValidate aria-labelledby={headingId} aria-busy={busy || undefined}>
            <div className="mz-auth-group">
              <TextField label={t("email")} type="email" name="email" dir="ltr" inputMode="email" autoCapitalize="none" spellCheck={false} autoComplete="username"
                required aria-required="true" inputRef={emailRef} readOnly={busy} value={email} error={fieldError.email ? t(`errors.${fieldError.email}`) : undefined}
                onChange={(e) => { setEmail(e.target.value); setFieldError((f) => ({ ...f, email: undefined })); }} />
              <PasswordField label={t("password")} name="password" autoComplete="current-password" required aria-required="true" inputRef={passwordRef} readOnly={busy}
                value={password} showLabel={t("show")} hideLabel={t("hide")} capsLabel={t("capsLock")}
                error={fieldError.password ? t(`errors.${fieldError.password}`) : undefined}
                onChange={(e) => { setPassword(e.target.value); setFieldError((f) => ({ ...f, password: undefined })); }} />
            </div>
            {alert}
            <PrimaryCta label={t("signIn")} busy={busy} />
          </form>
        </>
      )}
    </StepHost>
  );
}
