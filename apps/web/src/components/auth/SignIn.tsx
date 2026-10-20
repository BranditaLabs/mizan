"use client";

import { normalizePhone } from "@mizan/shared";
import {
  createUserWithEmailAndPassword, getMultiFactorResolver, PhoneAuthProvider, PhoneMultiFactorGenerator,
  sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPhoneNumber,
  type ConfirmationResult, type MultiFactorError, type MultiFactorResolver, type PhoneMultiFactorInfo,
} from "firebase/auth";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { Bdi } from "@/components/Bdi";
import { SegmentButton, Segmented } from "@/components/Segmented";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { useRouter } from "@/i18n/navigation";
import { authErrorCode, authErrorKey, type AuthErrorKey } from "@/lib/auth-errors";
import { firebaseAuth, smsVerifier } from "@/lib/firebase";
import { useSession } from "@/lib/session";

const RECAPTCHA = "sms-verifier";

type Mfa = { resolver: MultiFactorResolver; verificationId: string; hint: string };

/**
 * Sign-in (E4-2). Email + password, then the SMS second step for accounts that turned it on
 * (owners and admins must: the API answers mfa_required otherwise). Phone number + SMS code for
 * confirmation and warehouse teams. Once signed in, the store gate decides where to go.
 */
export function SignIn({ next, enrolled }: { next: string; enrolled: boolean }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const { status } = useSession();
  const auth = firebaseAuth();

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
        if (authErrorCode(err) !== "auth/multi-factor-auth-required") throw err;
        const resolver = getMultiFactorResolver(auth, err as MultiFactorError);
        const hint = resolver.hints.find((h) => h.factorId === PhoneMultiFactorGenerator.FACTOR_ID) as PhoneMultiFactorInfo | undefined;
        if (!hint) throw err;
        const verificationId = await new PhoneAuthProvider(auth).verifyPhoneNumber({ multiFactorHint: hint, session: resolver.session }, smsVerifier(auth, RECAPTCHA));
        setCode("");
        setMfa({ resolver, verificationId, hint: hint.phoneNumber.replace(/\D/g, "").slice(-4) });
      }
    });
  };

  const onMfa = (e: FormEvent) => {
    e.preventDefault();
    if (!mfa) return;
    void run(async () => {
      const assertion = PhoneMultiFactorGenerator.assertion(PhoneAuthProvider.credential(mfa.verificationId, code.trim()));
      await mfa.resolver.resolveSignIn(assertion);
    });
  };

  const onReset = () => {
    void run(async () => {
      auth.languageCode = locale;
      await sendPasswordResetEmail(auth, email.trim());
      setResetSent(true);
    });
  };

  const onPhone = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (confirmation) {
        await confirmation.confirm(code.trim());
        return;
      }
      const p = normalizePhone(phone, "EG");
      if (!p) {
        setError("invalidPhone");
        return;
      }
      auth.languageCode = locale;
      setCode("");
      setConfirmation(await signInWithPhoneNumber(auth, p.e164, smsVerifier(auth, RECAPTCHA)));
    });
  };

  const errorAlert = error ? <Alert tone="danger">{t(`errors.${error}`)}</Alert> : null;
  const codeField = (hint: React.ReactNode) => (
    <Field label={t("code")} hint={hint} ltr inputMode="numeric" autoComplete="one-time-code" required autoFocus
      value={code} onChange={(e) => setCode(e.target.value)} name="code" />
  );

  return (
    <div className="flex flex-col gap-4">
      {enrolled ? <Alert tone="success">{t("enrolled")}</Alert> : null}
      <section className="rounded-lg border border-line bg-surface p-5 sm:p-6">
        {mfa ? (
          <form onSubmit={onMfa} className="flex flex-col gap-4" noValidate>
            <h1 className="font-display text-heading-md">{t("mfa.title")}</h1>
            <p className="text-body-sm text-text-2">{t.rich("mfa.body", { hint: mfa.hint, n: (c) => <Bdi code>{c}</Bdi> })}</p>
            {codeField(null)}
            {errorAlert}
            <Button type="submit" busy={busy}>{t("mfa.submit")}</Button>
          </form>
        ) : (
          <>
            <h1 className="font-display text-heading-md">{creating ? t("createTitle") : t("title")}</h1>
            <p className="mt-1.5 text-body-sm text-text-2">{t("subtitle")}</p>
            <div className="mt-5">
              <Segmented label={t("tabs.label")}>
                {(["email", "phone"] as const).map((m) => (
                  <SegmentButton key={m} pressed={method === m} onClick={() => { setMethod(m); setError(null); }}>{t(`tabs.${m}`)}</SegmentButton>
                ))}
              </Segmented>
            </div>
            {method === "email" ? (
              <form onSubmit={onEmail} className="mt-5 flex flex-col gap-4" noValidate>
                <Field label={t("email")} type="email" ltr autoComplete="email" required name="email"
                  value={email} onChange={(e) => setEmail(e.target.value)} />
                <Field label={t("password")} type="password" ltr autoComplete={creating ? "new-password" : "current-password"} required name="password"
                  hint={creating ? t("passwordHint") : undefined} value={password} onChange={(e) => setPassword(e.target.value)} />
                {resetSent ? <Alert tone="success">{t.rich("resetSent", { email: email.trim(), e: (c) => <Bdi code>{c}</Bdi> })}</Alert> : null}
                {errorAlert}
                <Button type="submit" busy={busy}>{creating ? t("createSubmit") : t("signIn")}</Button>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button variant="ghost" onClick={() => { setCreating(!creating); setError(null); }}>{creating ? t("haveAccount") : t("createAccount")}</Button>
                  {creating ? null : <Button variant="ghost" onClick={onReset} disabled={!email.trim()}>{t("forgot")}</Button>}
                </div>
              </form>
            ) : (
              <form onSubmit={onPhone} className="mt-5 flex flex-col gap-4" noValidate>
                {confirmation ? (
                  <>
                    {codeField(t.rich("codeHint", { phone: phone.trim(), n: (c) => <Bdi code>{c}</Bdi> }))}
                    {errorAlert}
                    <Button type="submit" busy={busy}>{t("verify")}</Button>
                    <Button variant="ghost" onClick={() => { setConfirmation(null); setError(null); }}>{t("changeNumber")}</Button>
                  </>
                ) : (
                  <>
                    <Field label={t("phone")} type="tel" ltr autoComplete="tel" inputMode="tel" required name="phone"
                      hint={t.rich("phoneHint", { n: (c) => <Bdi code>{c}</Bdi> })} value={phone} onChange={(e) => setPhone(e.target.value)} />
                    {errorAlert}
                    <Button type="submit" busy={busy}>{t("sendCode")}</Button>
                  </>
                )}
              </form>
            )}
          </>
        )}
      </section>
      {status === "signed-in" ? <p role="status" className="text-center text-body-sm text-text-2">{t("redirecting")}</p> : null}
      <div id={RECAPTCHA} />
    </div>
  );
}
