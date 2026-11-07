"use client";

import { mmss, resendWait } from "@mizan/design-system/auth-code";
import { successWipe } from "@mizan/design-system/auth-motion";
import {
  announce, BackButton, CodeField, FormAlert, PasswordField, PrimaryCta, ResendTimer, StepHeader, StepHost, StrengthMeter, SuccessMark,
} from "@mizan/design-system/auth/react";
import { Icon } from "@mizan/design-system/icons/react";
import { normalizePhone, type PhoneCountry } from "@mizan/shared";
import {
  createUserWithEmailAndPassword, getMultiFactorResolver, GoogleAuthProvider, OAuthProvider, PhoneAuthProvider, PhoneMultiFactorGenerator,
  SAMLAuthProvider, sendEmailVerification, sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPhoneNumber, signInWithPopup,
  type ConfirmationResult, type MultiFactorError, type MultiFactorResolver, type PhoneMultiFactorInfo,
} from "firebase/auth";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useReducer, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Segmented } from "@/components/ui/Choice";
import { Link, useRouter } from "@/i18n/navigation";
import { apiClient, ApiError, ok } from "@/lib/api/client";
import { authErrorCode, authErrorKey, authErrorPlace, isInAppBrowser, retryAfterOf, SILENT, type AuthErrorKey, type AuthField } from "@/lib/auth-errors";
import { CODE_STEPS, flow, focusFor, initialFlow, type SignInStep } from "@/lib/auth/flow";
import { draft, lastCountry, lastMethod, signupIntent, verifySent } from "@/lib/auth/intent";
import type { AuthParams, Plan } from "@/lib/auth/params";
import { passwordStrength, type Strength } from "@/lib/auth/password-strength";
import { authUi, type Scene } from "@/lib/auth/ui-store";
import { checkCode, checkEmail, checkPassword, checkPhone, countryFromLanguages, groupPhone, lastFour, PHONE_EXAMPLE } from "@/lib/auth/validate";
import { firebaseAuth, setAuthLanguage, smsVerifier } from "@/lib/firebase";
import { legalPath } from "@/lib/legal";
import { useSession } from "@/lib/session";
import { bdi, EmailField, GoogleMark, IdentityChip, LinkResend, OfflineBanner, OutageCard, PhoneField, ReasonBanner, RecaptchaNote, TrialChip } from "./fields";

/** The reCAPTCHA container: a direct child of the persistent frame (Frame.tsx), never moved or remounted. */
const RECAPTCHA = "sms-verifier";
/** Firebase's own "too many requests" carries no wait: the button holds 30s, the copy promises no exact time. */
const HOLD_S = 30;
const SLOW_MS = 8000;

/** Keeps a field ref unless the element leaving is not the one it points at (the exiting step unmounts later). */
function keep(r: { current: HTMLInputElement | null }, el: HTMLInputElement | null) {
  if (el) r.current = el;
  else if (r.current && !r.current.isConnected) r.current = null;
}
function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
}

type Mfa = { resolver: MultiFactorResolver; verificationId: string; hint: string; phone: PhoneMultiFactorInfo };
type FormError = { key: AuthErrorKey; at: number; action?: ReactNode };
type FieldErrors = Partial<Record<AuthField, AuthErrorKey>>;

/**
 * Sign-in and create account (AU-1, auth spec §2): one card, one step at a time, inside the
 * persistent frame. Email and password on one step (or a mobile number and its code); the SMS
 * second step for accounts that turned it on (the API answers mfa_required otherwise); a reset
 * link that lands on "Check your email"; Google and the company's own sign-in (SSO, A-9).
 * Steps come from a pure reducer (lib/auth/flow.ts) and move through StepHost's motion. Errors are
 * never Firebase's text: each code maps to a message and a place (a field, or the form's alert).
 */
export function SignIn({ params }: { params: AuthParams }) {
  const t = useTranslations("auth");
  const tf = useTranslations("frame");
  const locale = useLocale();
  const router = useRouter();
  const { status } = useSession();
  const auth = firebaseAuth();
  const headingId = useId();

  const [s, dispatch] = useReducer(flow, params, (p) => initialFlow({ mode: p.mode }));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [country, setCountry] = useState<PhoneCountry>("EG");
  const [phone, setPhone] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [rejected, setRejected] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null);
  const [mfa, setMfa] = useState<Mfa | null>(null);
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<FormError | null>(null);
  const [sends, setSends] = useState({ count: 0, at: 0, just: false });
  const [linkAt, setLinkAt] = useState(0);
  /** Seconds left of the hold after "too many attempts" (0: not held). */
  const [holdLeft, setHoldLeft] = useState(0);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [outage, setOutage] = useState<{ attempt: number } | null>(null);
  const [reasonShown, setReasonShown] = useState(true);
  const [plan, setPlan] = useState<Plan>(params.plan);
  const [strength, setStrength] = useState<{ level: Strength; score: number } | null>(null);
  const [slow, setSlow] = useState(false);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const phoneRef = useRef<HTMLInputElement | null>(null);
  // The outgoing step unmounts after its exit: only clear a ref that still points at its own field.
  const emailEl = useCallback((el: HTMLInputElement | null) => keep(emailRef, el), []);
  const passwordEl = useCallback((el: HTMLInputElement | null) => keep(passwordRef, el), []);
  const phoneEl = useCallback((el: HTMLInputElement | null) => keep(phoneRef, el), []);
  const pressed = useRef<{ x: number; y: number } | null>(null);
  const [wipeFrom, setWipeFrom] = useState<{ x: number; y: number } | null>(null);
  const retryRef = useRef<() => void>(() => {});
  /** The method changed from the Email/Phone control: the new form fades in under it (not on first paint). */
  const [swapTo, setSwapTo] = useState<string | null>(null);
  /** The remembered method replaced the first form after paint: its field takes the focus the first one had. */
  const refocus = useRef(false);
  const retrySso = useCallback(() => retryRef.current(), []);
  const creating = s.mode === "create";
  const done = status === "signed-in";
  const step: SignInStep = done ? "done" : s.step;
  const clearErrors = () => { setFieldErrors({}); setFormError(null); };

  /* ── Remembered method and country, the draft, the sign-up intent: read after hydration, in the next frame ── */
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const d = draft.read();
      const m = d?.method ?? lastMethod.read();
      if (m) { refocus.current = true; dispatch({ type: "method", method: m }); }
      if (d?.email) setEmail(d.email);
      setCountry(lastCountry.read() ?? countryFromLanguages(navigator.languages));
    });
    if (params.mode === "create") signupIntent.save(params.plan, params.interval, params.enterprise);
    return () => cancelAnimationFrame(id);
  }, [params]);

  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    const a = document.activeElement;
    if (a && a !== document.body && a.isConnected) return; // the person already moved on
    if (!window.matchMedia?.("(pointer: fine)").matches) return;
    (s.method === "phone" ? phoneRef : emailRef).current?.focus({ preventScroll: true });
  }, [s.method]);

  /* ── What the frame needs: the stage's scene, the mode (the bar's link says the opposite), code steps lock the language ── */
  useEffect(() => {
    const scene: Scene = outage ? "outage" : params.reason === "shopify" || params.reason === "shopifyGeneric" ? "shopify"
      : params.reason === "invite" ? "invite" : creating ? "signup" : "signIn";
    authUi.set({ scene, mode: s.mode, locked: CODE_STEPS.has(step) });
  }, [s.mode, step, outage, creating, params.reason]);
  useEffect(() => () => authUi.set({ scene: null, mode: null, locked: false }), []);
  useEffect(() => authUi.onModeRequest((mode) => { setFieldErrors({}); setFormError(null); dispatch({ type: "mode", mode }); }), []);

  /* ── Network ── */
  useEffect(() => {
    const on = () => announce(tf("online"));
    const off = () => draft.save({ email, method: s.method });
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [tf, email, s.method]);

  /* ── The hold after "too many attempts" ticks once a second ── */
  const held = holdLeft > 0;
  useEffect(() => {
    if (!held) return;
    const id = window.setTimeout(() => {
      setHoldLeft((n) => Math.max(0, n - 1));
      if (holdLeft === 1) {
        setFormError((e) => (e && (e.key === "tooMany" || e.key === "tooManyWait") ? null : e));
        announce(t("retryReady"));
      }
    }, 1000);
    return () => window.clearTimeout(id);
  }, [held, holdLeft, t]);

  /* ── Signed in: the success moment, then the way back. The wipe only after a press here. ── */
  useEffect(() => {
    if (!done) return;
    lastMethod.save(s.method);
    draft.clear();
    router.replace(params.next);
    const id = window.setTimeout(() => setSlow(true), SLOW_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  /* ── A refused password: the field takes focus with its value selected, so retyping replaces it ── */
  useEffect(() => {
    if (formError?.key !== "invalidCredential") return;
    const el = passwordRef.current;
    if (!el?.isConnected) return;
    el.focus({ preventScroll: true });
    el.select();
  }, [formError?.key, formError?.at]);

  /* ── The new password's strength, after 300ms of quiet ── */
  useEffect(() => {
    const id = window.setTimeout(() => setStrength(creating && password ? passwordStrength(password, { email }) : null), password ? 300 : 0);
    return () => window.clearTimeout(id);
  }, [password, creating, email]);

  // Password managers read the rule from the attribute (React has no prop for it).
  useEffect(() => {
    const el = passwordRef.current;
    if (!el) return;
    if (creating) el.setAttribute("passwordrules", "minlength: 8;"); else el.removeAttribute("passwordrules");
  });

  /* ── Each step names the tab ── */
  const titleOf = (step: SignInStep): string => ({
    start: s.method === "phone" ? t("phoneTitle") : creating ? t("createTitle") : t("title"),
    phoneCode: t("codeTitle"), mfa: t("mfa.title"), reset: t("resetTitle"), resetSent: t("resetSentTitle"), sso: t("ssoTitle"), done: t("doneTitle"),
  })[step];
  useEffect(() => { document.title = tf("stepTitle", { step: titleOf(step) }); });
  useEffect(() => { retryRef.current = () => { void run(ssoLookup); }; });

  const go = (step: Exclude<SignInStep, "start" | "done">) => { clearErrors(); dispatch({ type: "go", step }); };
  const back = () => { clearErrors(); setCode(""); setRejected(null); dispatch({ type: "back" }); };

  if (!auth) return <FormAlert tone="warning" focusOnShow={false}>{t("notConfigured")}</FormAlert>;

  /* ── Errors: to a field (focus moves there) or to the form's alert ── */
  function fail(e: unknown) {
    const code0 = authErrorCode(e);
    if (SILENT.has(code0)) return;
    const key = authErrorKey(e);
    if (key === "generic" && code0) console.warn("[auth]", code0); // the code only, never PII
    if (key === "tooMany") setHoldLeft(HOLD_S);
    if (key === "tooManyWait") setHoldLeft(retryAfterOf(e) ?? HOLD_S);
    if (key === "network" && !navigator.onLine) return; // the offline banner says it
    if (e instanceof ApiError && (e.status === 0 || e.status >= 502)) return void setOutage((o) => ({ attempt: (o?.attempt ?? -1) + 1 }));
    const place = authErrorPlace(key);
    if (place === "silent") return;
    if (place !== "form") {
      setFieldErrors({ [place.field]: key });
      ({ email: emailRef, password: passwordRef, phone: phoneRef, code: null })[place.field]?.current?.focus();
      return;
    }
    setFormError({ key, at: Date.now(), action: actionFor(key) });
  }

  function actionFor(key: AuthErrorKey): ReactNode {
    if (key === "smsQuota") return <button type="button" className="mz-auth-link" onClick={() => { clearErrors(); dispatch({ type: "restart" }); dispatch({ type: "method", method: "email" }); }}>{t("errorAction.useEmail")}</button>;
    if (key === "captchaFailed") return <button type="button" className="mz-auth-link" onClick={() => window.location.reload()}>{t("errorAction.reload")}</button>;
    if (key === "storageBlocked" || key === "inAppBrowser") return <CopyLink />;
    if (key === "popupBlocked" || key === "network") return <button type="button" className="mz-auth-link" onClick={clearErrors}>{t("errorAction.tryAgain")}</button>;
    return null;
  }

  async function run(work: () => Promise<void>, el?: HTMLElement | null) {
    if (busy || held || !online) return;
    if (el) { const r = el.getBoundingClientRect(); pressed.current = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
    setBusy(true);
    clearErrors();
    try {
      await work();
      // Signed in by this press: the success wipe grows from the button.
      if (auth?.currentUser && pressed.current) setWipeFrom(pressed.current);
      pressed.current = null;
    } catch (e) {
      pressed.current = null;
      fail(e);
    } finally {
      setBusy(false);
    }
  }
  const submitter = (e: FormEvent) => ((e.nativeEvent as SubmitEvent).submitter as HTMLElement | null) ?? (e.currentTarget as HTMLFormElement).querySelector<HTMLElement>("[type=submit]");

  /** Client checks on submit: every field, focus on the first wrong one, one summary for screen readers. */
  function invalid(checks: Array<[AuthField, AuthErrorKey | null]>): boolean {
    const errs = Object.fromEntries(checks.filter(([, k]) => k)) as FieldErrors;
    if (Object.keys(errs).length === 0) return false;
    setFieldErrors(errs);
    const first = checks.find(([, k]) => k)![0];
    ({ email: emailRef, password: passwordRef, phone: phoneRef, code: null })[first]?.current?.focus();
    announce(t("errors.fixFields", { count: Object.keys(errs).length }));
    return true;
  }

  /** A first factor that needs the SMS second step (email or Google): send the code and ask for it. */
  async function secondStep(err: unknown) {
    if (!auth || authErrorCode(err) !== "auth/multi-factor-auth-required") throw err;
    const resolver = getMultiFactorResolver(auth, err as MultiFactorError);
    const hint = resolver.hints.find((h) => h.factorId === PhoneMultiFactorGenerator.FACTOR_ID) as PhoneMultiFactorInfo | undefined;
    if (!hint) throw Object.assign(new Error("mfa"), { code: "auth/unsupported-first-factor" });
    setAuthLanguage(locale);
    const verificationId = await new PhoneAuthProvider(auth).verifyPhoneNumber({ multiFactorHint: hint, session: resolver.session }, smsVerifier(auth, RECAPTCHA));
    const four = lastFour(hint.phoneNumber);
    setMfa({ resolver, verificationId, hint: four, phone: hint });
    setCode(""); setRejected(null);
    setSends({ count: 1, at: Date.now(), just: false });
    announce(t("live.codeSent", { hint: four }));
    go("mfa");
  }

  const onEmail = (e: FormEvent) => {
    e.preventDefault();
    const el = submitter(e);
    if (invalid([["email", checkEmail(email, "submit")], ["password", checkPassword(password, "submit", creating)]])) return;
    void run(async () => {
      const address = email.trim();
      if (creating) {
        const { user } = await createUserWithEmailAndPassword(auth, address, password);
        // The confirmation link goes out at once (not awaited); two-step and welcome pick it up.
        auth.languageCode = locale;
        verifySent.mark();
        sendEmailVerification(user, { url: `${window.location.origin}/${locale}/sign-in?reason=verified`, handleCodeInApp: false }).catch(() => verifySent.clear());
        return;
      }
      try {
        await signInWithEmailAndPassword(auth, address, password);
      } catch (err) {
        await secondStep(err);
      }
    }, el);
  };

  const onGoogle = (el: HTMLElement) => {
    if (isInAppBrowser(navigator.userAgent)) { setFormError({ key: "inAppBrowser", at: Date.now(), action: <CopyLink /> }); return; }
    void run(async () => {
      auth.languageCode = locale;
      const google = new GoogleAuthProvider();
      google.setCustomParameters({ prompt: "select_account" });
      try {
        await signInWithPopup(auth, google);
      } catch (err) {
        if (SILENT.has(authErrorCode(err))) { pressed.current = null; return; }
        await secondStep(err);
      }
    }, el);
  };

  /** Company sign-in: which provider the work email's domain uses, then that provider's window (SAML or OIDC). */
  const ssoLookup = async () => {
    const { providerId } = await ok(apiClient({ user: null, locale }).POST("/v1/public/sso", { body: { email: email.trim() } }));
    setOutage(null);
    const provider = providerId.startsWith("saml.") ? new SAMLAuthProvider(providerId) : new OAuthProvider(providerId);
    if (provider instanceof OAuthProvider) provider.setCustomParameters({ login_hint: email.trim() });
    setAuthLanguage(locale);
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      if (!SILENT.has(authErrorCode(err))) throw err;
      pressed.current = null;
    }
  };
  const onSso = (e: FormEvent) => {
    e.preventDefault();
    const el = submitter(e);
    if (invalid([["email", checkEmail(email, "submit")]])) return;
    void run(ssoLookup, el);
  };

  const sendPhoneCode = async () => {
    const p = normalizePhone(phone, country);
    if (!p) throw Object.assign(new Error("phone"), { code: "auth/invalid-phone-number" });
    setAuthLanguage(locale);
    setConfirmation(await signInWithPhoneNumber(auth, p.e164, smsVerifier(auth, RECAPTCHA)));
    setSentTo(p.e164);
    lastCountry.save(country);
    announce(t("live.codeSent", { hint: lastFour(p.e164) }));
  };
  const onPhone = (e: FormEvent) => {
    e.preventDefault();
    const el = submitter(e);
    if (invalid([["phone", checkPhone(phone, country, "submit")]])) return;
    void run(async () => {
      await sendPhoneCode();
      setCode(""); setRejected(null);
      setSends({ count: 1, at: Date.now(), just: false });
      go("phoneCode");
    }, el);
  };

  const resend = () => void run(async () => {
    if (s.step === "mfa" && mfa) {
      const verificationId = await new PhoneAuthProvider(auth).verifyPhoneNumber({ multiFactorHint: mfa.phone, session: mfa.resolver.session }, smsVerifier(auth, RECAPTCHA));
      setMfa({ ...mfa, verificationId });
    } else {
      await sendPhoneCode();
    }
    setCode(""); setRejected(null);
    setSends((x) => ({ count: x.count + 1, at: Date.now(), just: true }));
    announce(t("live.codeResent"));
  });

  const verifyCode = (value: string, el?: HTMLElement | null) => {
    if (checkCode(value)) { setFieldErrors({ code: "codeIncomplete" }); return; }
    void run(async () => {
      try {
        if (s.step === "mfa" && mfa) {
          await mfa.resolver.resolveSignIn(PhoneMultiFactorGenerator.assertion(PhoneAuthProvider.credential(mfa.verificationId, value)));
        } else if (confirmation) {
          await confirmation.confirm(value);
        }
      } catch (err) {
        const key = authErrorKey(err);
        if (key === "invalidCode") setRejected(value);
        if (key === "mfaTimedOut") { setPassword(""); setMfa(null); dispatch({ type: "restart" }); }
        throw err;
      }
    }, el ?? document.querySelector<HTMLElement>("[data-step] [type=submit]"));
  };
  const onCode = (e: FormEvent) => { e.preventDefault(); verifyCode(code, submitter(e)); };

  const sendReset = async () => {
    auth.languageCode = locale;
    await sendPasswordResetEmail(auth, email.trim(), { url: `${window.location.origin}/${locale}/sign-in?reason=reset` });
    setLinkAt(Date.now());
  };
  const onReset = (e: FormEvent) => {
    e.preventDefault();
    if (invalid([["email", checkEmail(email, "submit")]])) return;
    void run(async () => { await sendReset(); go("resetSent"); });
  };

  /* ── Pieces ── */
  const fe = (f: AuthField): ReactNode => {
    const k = fieldErrors[f];
    if (!k) return undefined;
    const text = k === "invalidPhone" ? t.rich("errors.invalidPhone", { example: PHONE_EXAMPLE[country], n: bdi }) : t(`errors.${k}`);
    if (k === "emailInUse") {
      return <>{text}{" "}<button type="button" onClick={() => { clearErrors(); dispatch({ type: "mode", mode: "signin" }); }}>{t("errorAction.signInInstead")}</button></>;
    }
    return text;
  };
  // A refused code or password puts focus in its field (value selected); the alert is still announced (role=alert).
  const fieldTakesFocus = formError?.key === "invalidCode" || formError?.key === "invalidCredential";
  const alert = formError ? (
    <FormAlert alertKey={formError.at} action={formError.action} focusOnShow={!fieldTakesFocus}>
      {formError.key === "tooManyWait"
        ? t.rich("errors.tooManyWait", { time: mmss(holdLeft), n: bdi })
        : t(`errors.${formError.key}`)}
    </FormAlert>
  ) : null;
  const blocked = held || !online;
  // Sent here by a Shopify install: "Create an account" is a full-width pill under the primary.
  const promoted = !creating && (params.reason === "shopify" || params.reason === "shopifyGeneric");
  const cta = (label: string, icon?: Parameters<typeof PrimaryCta>[0]["icon"]) => (
    <PrimaryCta label={held && formError?.key === "tooMany" ? <>{label} · <bdi dir="ltr">{mmss(holdLeft)}</bdi></> : label} busy={busy}
      disabled={blocked} icon={icon} aria-describedby={!online ? "offline-reason" : undefined} />
  );
  const emailField = (autoComplete: "username" | "email" = "username") => (
    <EmailField value={email} autoComplete={autoComplete} inputRef={emailEl} readOnly={busy} error={fe("email")}
      onChange={(v) => { setEmail(v); if (fieldErrors.email && !checkEmail(v, "blur")) setFieldErrors((x) => ({ ...x, email: undefined })); }}
      onBlur={(v) => { const k = checkEmail(v, "blur"); if (k) setFieldErrors((x) => ({ ...x, email: k })); }} />
  );
  const reason = !reasonShown ? null : params.enrolled ? <ReasonBanner tone="success" onDismiss={() => setReasonShown(false)}>{t("enrolled")}</ReasonBanner>
    : params.reason ? (
      // Every reason comes from a link anyone can craft: a neutral note that claims nothing about the account.
      <ReasonBanner tone="info" onDismiss={() => setReasonShown(false)}>
        {params.reason === "shopify" && params.shop ? t.rich("reason.shopify", { shop: params.shop, n: bdi }) : t(`reason.${params.reason}`)}
      </ReasonBanner>
    ) : null;

  let body: ReactNode;
  if (outage) {
    body = <OutageCard key={outage.attempt} attempt={outage.attempt} onRetry={retrySso} />;
  } else if (step === "done") {
    body = (
      <SuccessMark title={t("doneTitle")} text={slow ? t("slow") : t("opening")}>
        {slow ? <Link href={params.next} className="mz-auth-btn">{t("openStore")}</Link> : null}
      </SuccessMark>
    );
  } else if (s.step === "start") {
    body = (
      <>
        {reason}
        {!online ? <span id="offline-reason"><OfflineBanner /></span> : null}
        {creating ? <TrialChip plan={plan} interval={params.interval} enterprise={params.enterprise} onPlan={(p) => { setPlan(p); signupIntent.save(p, params.interval); }} /> : null}
        <StepHeader id={headingId} title={s.method === "phone" && !creating ? t("phoneTitle") : creating ? t("createTitle") : t("title")}
          body={creating ? t("createSubtitleTrial") : t("subtitle")} />
        <div data-stagger="">
          <Segmented label={t("tabs.label")} value={s.method} className="w-full [&>button]:min-h-11 [&>button]:flex-1 [&>button]:justify-center"
            options={(["email", "phone"] as const).map((m) => ({ value: m, label: t(`tabs.${m}`) }))}
            onChange={(m) => { clearErrors(); setSwapTo(`${s.mode}-${m}`); dispatch({ type: "method", method: m }); }} />
        </div>
        {s.method === "email" ? (
          <form key="email" className="mz-auth-swap" data-swap={swapTo === `${s.mode}-${s.method}` ? "" : undefined} onSubmit={onEmail} noValidate aria-labelledby={headingId} aria-busy={busy || undefined}>
            <div className="mz-auth-group">
              {emailField(creating ? "email" : "username")}
              <PasswordField label={t("password")} name="password" autoComplete={creating ? "new-password" : "current-password"} enterKeyHint="go" required aria-required="true"
                inputRef={passwordEl} readOnly={busy} value={password} showLabel={t("showChars")} hideLabel={t("hideChars")} capsLabel={t("capsLock")}
                extraDescribedBy={creating && strength ? "pw-strength" : undefined}
                error={fe("password")}
                hint={creating ? t("passwordHint") : undefined} helpTone={creating && password.length >= 8 ? "ok" : "hint"}
                onChange={(e) => { setPassword(e.target.value); if (fieldErrors.password && !checkPassword(e.target.value, "blur", creating)) setFieldErrors((x) => ({ ...x, password: undefined })); }}
                onBlur={(e) => { if (creating) { const k = checkPassword(e.target.value, "blur", true); if (k) setFieldErrors((x) => ({ ...x, password: k })); setStrength(e.target.value ? passwordStrength(e.target.value, { email }) : null); } }}
                aside={creating ? null : <button type="button" className="mz-auth-link" onClick={() => go("reset")}>{t("forgot")}</button>}
                below={creating && strength ? <StrengthMeter id="pw-strength" score={strength.score} label={t("strength.label", { level: t(`strength.${strength.level}`) })} /> : null} />
            </div>
            {alert}
            {cta(creating ? t("createSubmit") : t("continue"))}
            {promoted ? <PrimaryCta type="button" secondary label={t("createAccount")} icon="add" onClick={() => { clearErrors(); dispatch({ type: "mode", mode: "create" }); }} /> : null}
          </form>
        ) : (
          <form key="phone" className="mz-auth-swap" data-swap={swapTo === `${s.mode}-${s.method}` ? "" : undefined} onSubmit={onPhone} noValidate aria-labelledby={headingId} aria-busy={busy || undefined}>
            <PhoneField value={phone} country={country} inputRef={phoneEl} readOnly={busy} error={fe("phone")}
              hint={creating ? t("createPhoneNote") : t("phoneHintSms")}
              onCountry={(c) => { setCountry(c); setFieldErrors((x) => ({ ...x, phone: undefined })); }}
              onChange={(v) => { setPhone(v); if (fieldErrors.phone && !checkPhone(v, country, "blur")) setFieldErrors((x) => ({ ...x, phone: undefined })); }}
              onBlur={() => { const k = checkPhone(phone, country, "blur"); if (k) setFieldErrors((x) => ({ ...x, phone: k })); else if (phone.trim()) setPhone(groupPhone(phone, country)); }} />
            {alert}
            {cta(t("continue"))}
            <RecaptchaNote />
          </form>
        )}
        <div className="mz-auth-divider" data-stagger="">{t("or")}</div>
        <div className={`mz-auth-providers ${creating ? "au-one" : ""}`} data-stagger="">
          <button type="button" onClick={(e) => onGoogle(e.currentTarget)} aria-disabled={busy || blocked || undefined} aria-label={t("google")} className="mz-auth-btn">
            <GoogleMark />
            {t("googleShort")}
          </button>
          {creating ? null : (
            <button type="button" onClick={() => go("sso")} aria-disabled={busy || undefined} className="mz-auth-btn">
              <Icon name="locked" size={16} />
              {t("sso")}
            </button>
          )}
        </div>
        {creating ? (
          <p className="mz-auth-note" data-stagger="">
            {t.rich("legalLine", { terms: (c) => <Link href={legalPath("terms")}>{c}</Link>, privacy: (c) => <Link href={legalPath("privacy")}>{c}</Link> })}
          </p>
        ) : null}
        {promoted ? null : <p className="mz-auth-toggle" data-stagger="">
          {creating ? t("haveQ") : t("newQ")}{" "}
          <button type="button" className="mz-auth-link" onClick={() => { clearErrors(); dispatch({ type: "mode", mode: creating ? "signin" : "create" }); }}>
            {creating ? t("signInLink") : t("createAccount")}
          </button>
        </p>}
      </>
    );
  } else if (s.step === "phoneCode" || s.step === "mfa") {
    const sentLine = s.step === "mfa" && mfa
      ? t.rich("mfa.body", { hint: mfa.hint, n: (c) => <bdi dir="ltr" className="mono font-semibold text-text">{c}</bdi> })
      : t.rich("codeSent", { phone: sentTo, n: (c) => <bdi dir="ltr" className="mono font-semibold text-text">{c}</bdi> });
    body = (
      <>
        <BackButton label={t("back")} onClick={() => { setConfirmation(null); setMfa(null); back(); }} />
        {s.step === "phoneCode" ? <IdentityChip value={sentTo} changeLabel={t("changeNumber")} onChange={() => { setConfirmation(null); back(); }} /> : null}
        <StepHeader id={headingId} icon={s.step === "mfa" ? "locked" : "sms"} title={s.step === "mfa" ? t("mfa.title") : t("codeTitle")} body={<span id={`${headingId}-sent`}>{sentLine}</span>} />
        <form onSubmit={onCode} noValidate aria-labelledby={headingId} aria-busy={busy || undefined}>
          <CodeField label={t("codeLabel")} value={code} busy={busy} rejected={rejected} describedBy={`${headingId}-sent`}
            invalid={formError?.key === "invalidCode"} error={fieldErrors.code ? t(`errors.${fieldErrors.code}`) : undefined}
            onChange={(v) => { setCode(v); if (fieldErrors.code) setFieldErrors({}); if (formError?.key === "invalidCode" && v !== rejected) setFormError(null); }}
            onComplete={(v) => verifyCode(v)} />
          <ResendTimer seconds={resendWait(sends.count)} startedAt={sends.at} busy={busy} justSent={sends.just} sentLabel={t("sent")}
            resendLabel={t("resend")} readyMessage={t("live.resendReady")} onResend={resend}
            countdown={(time) => t.rich("resendIn", { time: "", n: () => time })} />
          {alert}
          {cta(s.step === "mfa" ? t("mfa.submit") : t("verifySignIn"), "confirm")}
          <RecaptchaNote />
        </form>
        {s.step === "mfa" ? (
          <details className="mz-auth-note">
            <summary>{t("mfaNoPhoneQ")}</summary>
            <p className="mt-1">{t("mfaNoPhoneA")}</p>
          </details>
        ) : null}
      </>
    );
  } else if (s.step === "reset") {
    body = (
      <>
        <BackButton label={t("back")} onClick={back} />
        <StepHeader id={headingId} icon="locked" title={t("resetTitle")} body={t("resetBody")} />
        <form onSubmit={onReset} noValidate aria-labelledby={headingId} aria-busy={busy || undefined}>
          {emailField()}
          {alert}
          {cta(t("resetSend"))}
        </form>
      </>
    );
  } else if (s.step === "resetSent") {
    body = (
      <>
        <BackButton label={t("back")} onClick={back} />
        <StepHeader id={headingId} icon="email" title={t("resetSentTitle")} body={t.rich("resetSent", { email: email.trim(), e: bdi })} />
        <p className="mz-auth-sub" data-stagger="">{t("resetSpam")}</p>
        <LinkResend startedAt={linkAt} busy={busy} onResend={() => void run(sendReset)} />
        {alert}
        <PrimaryCta type="button" label={t("backToSignIn")} onClick={() => { clearErrors(); dispatch({ type: "restart" }); }} />
      </>
    );
  } else {
    body = (
      <>
        <BackButton label={t("back")} onClick={back} />
        <StepHeader id={headingId} icon="locked" title={t("ssoTitle")} body={t("ssoBody")} />
        <form onSubmit={onSso} noValidate aria-labelledby={headingId} aria-busy={busy || undefined}>
          {emailField()}
          {alert}
          {cta(t("ssoSubmit"))}
        </form>
      </>
    );
  }

  // The method is not part of the step: Email/Phone swaps only the form under the control, so the
  // radiogroup (and its focus and thumb) stays put; the mode is a step change.
  const stepKey = outage ? "outage" : step === "start" ? `start-${s.mode}` : step;
  return (
    <>
      <StepHost stepKey={stepKey} name={outage ? "outage" : step} direction={done ? "forward" : s.direction} focus={outage ? "heading" : focusFor(step)} className="mz-auth-stagger">
        {body}
      </StepHost>
      {wipeFrom ? <Wipe from={wipeFrom} /> : null}
    </>
  );
}

/** The success wipe over the whole screen, with the scale settling on it (decorative; the card says the same). */
function Wipe({ from }: { from: { x: number; y: number } | null }) {
  const t = useTranslations("auth");
  // Rendered only in the browser, after a press: the frame is there to portal into.
  const [host] = useState<Element | null>(() => document.querySelector(".mz-auth"));
  useEffect(() => {
    const w = successWipe(from ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 });
    return () => { w.el.remove(); };
  }, [from]);
  if (!host) return null;
  return createPortal(
    <div className="mz-auth-overlay" aria-hidden="true">
      <SuccessMark title={t("doneTitle")} text={t("opening")} />
    </div>, host);
}

/** For browsers that cannot sign in here (in-app browsers, blocked storage): copy the page's link to open elsewhere. */
function CopyLink() {
  const t = useTranslations("frame");
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="mz-auth-link" onClick={() => {
      void navigator.clipboard?.writeText(window.location.href).then(() => { setDone(true); announce(t("linkCopied")); }, () => {});
    }}>{done ? t("linkCopied") : t("copyLink")}</button>
  );
}
