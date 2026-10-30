"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { normalizePhone } from "@mizan/shared";
import {
  createUserWithEmailAndPassword, getMultiFactorResolver, GoogleAuthProvider, OAuthProvider, PhoneAuthProvider, PhoneMultiFactorGenerator,
  SAMLAuthProvider, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPhoneNumber, signInWithPopup,
  type ConfirmationResult, type MultiFactorError, type MultiFactorResolver, type PhoneMultiFactorInfo,
} from "firebase/auth";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Segmented } from "@/components/ui/Choice";
import { LedgerBars } from "@/components/ui/Loader";
import { useRouter } from "@/i18n/navigation";
import { apiClient, ok } from "@/lib/api/client";
import { authErrorCode, authErrorKey, type AuthErrorKey } from "@/lib/auth-errors";
import { firebaseAuth, setAuthLanguage, smsVerifier } from "@/lib/firebase";
import { useSession } from "@/lib/session";
import { AuthHeading, BackLink, CodeField, Done, GlassField, PasswordField, Step, StepIcon } from "./kit";

const RECAPTCHA = "sms-verifier";
const CLOSED = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"]);
/** The countries whose mobile numbers Mizan reads (@mizan/shared normalizePhone). */
const COUNTRIES = [{ code: "EG", dial: "+20" }, { code: "SA", dial: "+966" }, { code: "AE", dial: "+971" }] as const;
type Country = (typeof COUNTRIES)[number]["code"];
const RESEND_S = 60;

type Mfa = { resolver: MultiFactorResolver; verificationId: string; hint: string };
type StepName = "start" | "phoneCode" | "mfa" | "reset" | "sso";

/**
 * Sign-in (E4-2) as the "Sign in · glass" board of the Mizan Glass canvas, one step at a time.
 * Start: email and password (or a new account), or a mobile number; then Google or the company's
 * own sign-in (SSO, A-9: the work email finds the provider Mizan staff set up). Then the code we
 * texted (phone sign-in, with a resend countdown), the SMS second step for accounts that turned it on
 * (owners and admins must: the API answers mfa_required otherwise), or a password reset link. Once
 * signed in, the scale weighs while the store gate opens the store.
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
  const [country, setCountry] = useState<Country>("EG");
  const [phone, setPhone] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [mfa, setMfa] = useState<Mfa | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthErrorKey | null>(null);
  const [resetSent, setResetSent] = useState(false);
  const [wait, setWait] = useState(0);

  useEffect(() => {
    if (status === "signed-in") router.replace(next);
  }, [status, next, router]);
  useEffect(() => {
    if (wait <= 0) return;
    const id = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => window.clearTimeout(id);
  }, [wait]);

  if (!auth) return <Alert tone="warning">{t("notConfigured")}</Alert>;
  if (status === "signed-in") return <Done title={t("doneTitle")} text={t("opening")} />;

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

  /** Company sign-in: which provider the work email's domain uses, then that provider's window (SAML or OIDC). */
  const onSso = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const { providerId } = await ok(apiClient({ user: null, locale }).POST("/v1/public/sso", { body: { email: email.trim() } }));
      const provider = providerId.startsWith("saml.") ? new SAMLAuthProvider(providerId) : new OAuthProvider(providerId);
      if (provider instanceof OAuthProvider) provider.setCustomParameters({ login_hint: email.trim() });
      setAuthLanguage(locale);
      try {
        await signInWithPopup(auth, provider);
      } catch (err) {
        if (!CLOSED.has(authErrorCode(err))) throw err;
      }
    });
  };

  const sendCode = async () => {
    const p = normalizePhone(phone, country);
    if (!p) {
      setError("invalidPhone");
      return false;
    }
    setAuthLanguage(locale);
    setConfirmation(await signInWithPhoneNumber(auth, p.e164, smsVerifier(auth, RECAPTCHA)));
    setSentTo(p.e164);
    setWait(RESEND_S);
    return true;
  };

  const onPhone = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => { if (await sendCode()) go("phoneCode"); });
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
  const submit = (label: string, arrow = true) => (
    <button type="submit" className="btn btn-primary btn-lg h-(--_ctl) w-full" disabled={busy} aria-busy={busy || undefined}>
      {busy ? <LedgerBars /> : null}
      {label}
      {arrow && !busy ? <Icon name="forward" size={16} /> : null}
    </button>
  );
  const emailField = (
    <GlassField label={t("emailLabel")} type="email" dir="ltr" autoComplete="email" required name="email" placeholder={t("emailPlaceholder")}
      value={email} onChange={(e) => setEmail(e.target.value)} />
  );
  const mmss = `${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, "0")}`;

  return (
    <>
      {enrolled && step === "start" ? <Alert tone="success">{t("enrolled")}</Alert> : null}

      {step === "start" ? (
        <Step key={`start-${creating}`}>
          <AuthHeading title={creating ? t("createTitle") : t("title")} body={creating ? t("createSubtitle") : t("subtitle")} brief />
          <Segmented label={t("tabs.label")} value={method} className="w-full [&>button]:h-9 [&>button]:flex-1 [&>button]:justify-center"
            options={(["email", "phone"] as const).map((m) => ({ value: m, label: t(`tabs.${m}`) }))}
            onChange={(m) => { setMethod(m); setError(null); }} />
          {method === "email" ? (
            <form key="email" onSubmit={onEmail} className="flex flex-col gap-(--_gap)" noValidate>
              <div className="flex flex-col gap-[clamp(10px,1.8vh,16px)]">
                {emailField}
                <PasswordField label={t("password")} autoComplete={creating ? "new-password" : "current-password"} required name="password"
                  hint={creating ? t("passwordHint") : undefined} value={password} onChange={(e) => setPassword(e.target.value)}
                  aside={creating ? null : <button type="button" className="auth-link font-medium" onClick={() => { setResetSent(false); go("reset"); }}>{t("forgot")}</button>} />
              </div>
              {errorAlert}
              {submit(creating ? t("createSubmit") : t("continue"))}
            </form>
          ) : (
            <form key="phone" onSubmit={onPhone} className="flex flex-col gap-(--_gap)" noValidate>
              <GlassField label={t("phoneLabel")} type="tel" dir="ltr" autoComplete="tel-national" inputMode="tel" required name="phone"
                className="mono" placeholder={t("phonePlaceholder")} hint={t("phoneHintSms")} value={phone} onChange={(e) => setPhone(e.target.value)}
                lead={(
                  <select aria-label={t("countryCode")} value={country} onChange={(e) => setCountry(e.target.value as Country)} className="input h-(--_ctl) w-[88px] shrink-0 px-3 text-body-lg" dir="ltr">
                    {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.dial}</option>)}
                  </select>
                )} />
              {errorAlert}
              {submit(t("continue"))}
            </form>
          )}
          <div className="auth-divider [@media(max-height:640px)]:hidden">{t("or")}</div>
          <div className="grid grid-cols-2 gap-2.5">
            <button type="button" onClick={onGoogle} disabled={busy} aria-label={t("google")} className="btn btn-glass btn-lg h-(--_ctl) w-full">
              <GoogleMark />
              {t("googleShort")}
            </button>
            <button type="button" onClick={() => go("sso")} disabled={busy} className="btn btn-glass btn-lg h-(--_ctl) w-full">
              <Icon name="locked" size={16} />
              {t("sso")}
            </button>
          </div>
          <p className="muted m-0 text-center text-body">
            {creating ? t("haveQ") : t("newQ")}{" "}
            <button type="button" className="auth-link" onClick={() => { setCreating(!creating); setError(null); }}>{creating ? t("signInLink") : t("createAccount")}</button>
          </p>
        </Step>
      ) : null}

      {step === "phoneCode" ? (
        <Step key="phoneCode">
          <BackLink onClick={() => { setConfirmation(null); go("start"); }} />
          <StepIcon name="message" />
          <AuthHeading title={t("codeTitle")} body={t.rich("codeSent", { phone: sentTo, n: (c) => <bdi dir="ltr" className="mono font-semibold text-text">{c}</bdi> })} />
          <form onSubmit={onPhoneCode} className="flex flex-col gap-(--_gap)" noValidate>
            <CodeField label={t("codeLabel")} value={code} onChange={setCode}
              hint={(
                <span className="flex flex-wrap items-center justify-between gap-2">
                  {wait > 0 ? <span>{t.rich("resendIn", { time: mmss, n: (c) => <bdi dir="ltr" className="mono">{c}</bdi> })}</span> : <span />}
                  <button type="button" className="auth-link font-medium disabled:opacity-50" disabled={wait > 0 || busy} onClick={() => void run(async () => { await sendCode(); })}>{t("resend")}</button>
                </span>
              )} />
            {errorAlert}
            {submit(t("verifySignIn"), false)}
          </form>
        </Step>
      ) : null}

      {step === "mfa" && mfa ? (
        <Step key="mfa">
          <BackLink onClick={() => { setMfa(null); go("start"); }} />
          <StepIcon name="message" />
          <AuthHeading title={t("mfa.title")} body={t.rich("mfa.body", { hint: mfa.hint, n: (c) => <bdi dir="ltr" className="mono font-semibold text-text">{c}</bdi> })} />
          <form onSubmit={onMfa} className="flex flex-col gap-(--_gap)" noValidate>
            <CodeField label={t("codeLabel")} value={code} onChange={setCode} />
            {errorAlert}
            {submit(t("mfa.submit"), false)}
          </form>
        </Step>
      ) : null}

      {step === "reset" ? (
        <Step key="reset">
          <BackLink onClick={() => go("start")} />
          <AuthHeading title={t("resetTitle")} body={t("resetBody")} />
          <form onSubmit={onReset} className="flex flex-col gap-(--_gap)" noValidate>
            {emailField}
            {resetSent ? <Alert tone="success">{t.rich("resetSent", { email: email.trim(), e: (c) => <Bdi code>{c}</Bdi> })}</Alert> : null}
            {errorAlert}
            {submit(t("resetSend"), false)}
          </form>
        </Step>
      ) : null}

      {step === "sso" ? (
        <Step key="sso">
          <BackLink onClick={() => go("start")} />
          <StepIcon name="locked" />
          <AuthHeading title={t("ssoTitle")} body={t("ssoBody")} />
          <form onSubmit={onSso} className="flex flex-col gap-(--_gap)" noValidate>
            {emailField}
            {errorAlert}
            {submit(t("ssoSubmit"))}
          </form>
        </Step>
      ) : null}

      <div id={RECAPTCHA} />
    </>
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
