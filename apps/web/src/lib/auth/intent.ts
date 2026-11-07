import { TRIAL_DAYS as SHARED_TRIAL_DAYS } from "@mizan/shared";
import { parseInterval, parsePlan, type Interval, type Plan } from "./params";

/**
 * Small browser memories of the screens before a store. Nothing in browser storage holds personal
 * data (plan, billing, method, country, timestamps); the one memory that does, the offline draft's
 * email, lives in this module's memory only. Every read and write survives storage being off
 * (private windows, blocked site data) and re-validates what it reads, because anything in storage
 * may have been edited by hand.
 */

/** Trial length on every tier (@mizan/shared, the default of billing_settings.trial_days); the chip and the trial copy hide when it is 0. */
export const TRIAL_DAYS: number = SHARED_TRIAL_DAYS;

export type SignupIntent = { v: 1; plan: Plan; interval: Interval; enterprise: boolean; at: number };

const INTENT = "mizan.signup";
const INTENT_TTL = 24 * 60 * 60 * 1000;

function store(kind: "session" | "local"): Storage | null {
  try { return typeof window === "undefined" ? null : kind === "session" ? window.sessionStorage : window.localStorage; } catch { return null; }
}
function get(kind: "session" | "local", key: string): string | null {
  try { return store(kind)?.getItem(key) ?? null; } catch { return null; }
}
function set(kind: "session" | "local", key: string, value: string): void {
  try { store(kind)?.setItem(key, value); } catch { /* storage off: a convenience lost, nothing more */ }
}
function remove(kind: "session" | "local", key: string): void {
  try { store(kind)?.removeItem(key); } catch { /* nothing to clear */ }
}

/** The plan and billing the landing page chose, kept in this tab for the round trip through welcome. */
export const signupIntent = {
  save(plan: Plan, interval: Interval, enterprise = false, now = Date.now()): void {
    const v: SignupIntent = { v: 1, plan, interval, enterprise, at: now };
    set("session", INTENT, JSON.stringify(v));
  },
  read(now = Date.now()): SignupIntent | null {
    const raw = get("session", INTENT);
    if (!raw) return null;
    try {
      const o = JSON.parse(raw) as Partial<SignupIntent>;
      if (o.v !== 1 || typeof o.at !== "number" || now - o.at > INTENT_TTL || now < o.at - 60_000) { remove("session", INTENT); return null; }
      const p = parsePlan(o.enterprise ? "enterprise" : String(o.plan ?? ""));
      return { v: 1, plan: p.plan, enterprise: p.enterprise, interval: parseInterval(String(o.interval ?? "")), at: o.at };
    } catch {
      remove("session", INTENT);
      return null;
    }
  },
  clear(): void { remove("session", INTENT); },
};

/**
 * What `POST /v1/tenants` takes from the intent (E12-2a2 fields): the tier to try and the billing
 * after the trial. Enterprise is sent as asked (the API starts a Scale trial and keeps the ask in
 * the history); no intent sends nothing, and the API starts a Growth monthly trial.
 */
export function trialChoice(intent: SignupIntent | null): { plan?: "growth" | "scale" | "enterprise"; interval?: Interval } {
  if (!intent) return {};
  return { plan: intent.enterprise ? "enterprise" : intent.plan, interval: intent.interval };
}

/** The last way this browser signed in (email or phone), to open on it next time. */
export const lastMethod = {
  read(): "email" | "phone" | null { const v = get("local", "mizan.auth.method"); return v === "email" || v === "phone" ? v : null; },
  save(m: "email" | "phone"): void { set("local", "mizan.auth.method", m); },
};

/** The last country picked for a phone number. */
export const lastCountry = {
  read(): "EG" | "SA" | "AE" | null { const v = get("local", "mizan.phoneCountry"); return v === "EG" || v === "SA" || v === "AE" ? v : null; },
  save(c: "EG" | "SA" | "AE"): void { set("local", "mizan.phoneCountry", c); },
};

/** When the last verification link was sent (sign-up sends one by itself). */
export const verifySent = {
  read(): number | null { const n = Number(get("session", "mizan.verifySentAt")); return Number.isFinite(n) && n > 0 ? n : null; },
  mark(now = Date.now()): void { set("session", "mizan.verifySentAt", String(now)); },
  clear(): void { remove("session", "mizan.verifySentAt"); },
};

type Draft = { email?: string; method?: "email" | "phone" };
let memoryDraft: Draft | null = null;
/** The key an earlier build wrote the draft under; cleared so no email stays behind in a tab. */
const LEGACY_DRAFT = "mizan.auth.draft";

/**
 * What was typed before the connection dropped: the email and the method only, never a password
 * or code. In memory only (it survives the offline/online cycle inside the app, not a reload or a
 * closed tab), so the email is never written to browser storage. Cleared on every signed-in state.
 */
export const draft = {
  read(): Draft | null {
    const o = memoryDraft;
    if (!o) return null;
    return {
      email: typeof o.email === "string" && o.email.length <= 254 ? o.email : undefined,
      method: o.method === "phone" || o.method === "email" ? o.method : undefined,
    };
  },
  save(d: Draft): void { memoryDraft = { email: d.email, method: d.method }; },
  clear(): void { memoryDraft = null; remove("session", LEGACY_DRAFT); },
};

/** Everything above that belongs to one sign-in: cleared on sign-out and once a store is created. */
export function clearAuthMemory(): void {
  signupIntent.clear();
  draft.clear();
  verifySent.clear();
  remove("session", "mizan.resume");
}

/** The inline script for the frame: marks a repeat visit within 10 minutes before first paint (shorter motion). */
export const SEEN_SCRIPT =
  "try{var k='mizan.auth.seen',s=sessionStorage,t=+s.getItem(k)||0,n=Date.now();if(n-t<6e5)document.documentElement.setAttribute('data-auth-seen','');s.setItem(k,String(n))}catch(e){}";

/**
 * The inline script for the frame: before first paint, marks the stage as about to be built
 * (`data-stage-build` on <html>), unless the person asked for less motion or to save data. The
 * mark keeps the pieces the build animates unpainted (css/auth.css, with a CSS reveal after 1.5s
 * if the animator never loads); the animator removes it when it starts. Without it, the
 * server-rendered poster shows as is.
 */
export const STAGE_BUILD_SCRIPT =
  "try{var c=navigator.connection;if(!(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches)&&!(c&&c.saveData))document.documentElement.setAttribute('data-stage-build','')}catch(e){}";
