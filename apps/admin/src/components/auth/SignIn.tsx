"use client";

import {
  getMultiFactorResolver, PhoneAuthProvider, PhoneMultiFactorGenerator, signInWithEmailAndPassword,
  type MultiFactorError, type MultiFactorResolver, type PhoneMultiFactorInfo,
} from "firebase/auth";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { Bdi } from "@/components/Bdi";
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
 * Staff sign-in: the same Mizan account as the dashboard, email and password, then the SMS code.
 * The back office has no way in without a second factor: an account without one is told to turn
 * it on in the dashboard (Security) first.
 */
export function SignIn() {
  const t = useTranslations("auth");
  const router = useRouter();
  const { status } = useSession();
  const auth = firebaseAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [mfa, setMfa] = useState<Mfa | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthErrorKey | null>(null);

  useEffect(() => {
    if (status === "signed-in") router.replace("/");
  }, [status, router]);

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
      await mfa.resolver.resolveSignIn(PhoneMultiFactorGenerator.assertion(PhoneAuthProvider.credential(mfa.verificationId, code.trim())));
    });
  };

  const errorAlert = error ? <Alert tone="danger">{t(`errors.${error}`)}</Alert> : null;
  return (
    <section className="rounded-lg border border-line bg-surface p-5 sm:p-6">
      {mfa ? (
        <form onSubmit={onMfa} className="flex flex-col gap-4" noValidate>
          <h1 className="font-display text-heading-md">{t("mfa.title")}</h1>
          <p className="text-body-sm text-text-2">{t.rich("mfa.body", { hint: mfa.hint, n: (c) => <Bdi code>{c}</Bdi> })}</p>
          <Field label={t("code")} ltr inputMode="numeric" autoComplete="one-time-code" required autoFocus name="code" value={code} onChange={(e) => setCode(e.target.value)} />
          {errorAlert}
          <Button type="submit" busy={busy}>{t("mfa.submit")}</Button>
        </form>
      ) : (
        <form onSubmit={onEmail} className="flex flex-col gap-4" noValidate>
          <h1 className="font-display text-heading-md">{t("title")}</h1>
          <p className="text-body-sm text-text-2">{t("subtitle")}</p>
          <Field label={t("email")} type="email" ltr autoComplete="email" required name="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Field label={t("password")} type="password" ltr autoComplete="current-password" required name="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          {errorAlert}
          <Button type="submit" busy={busy}>{t("signIn")}</Button>
        </form>
      )}
      <div id={RECAPTCHA} />
    </section>
  );
}
