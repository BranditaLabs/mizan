import { parseInterval, parsePlan, type Interval, type Plan } from "./params";

/**
 * Small browser memories of the screens before a store. None holds personal data; every read and
 * write survives storage being off (private windows, blocked site data) and re-validates what it
 * reads, because anything in storage may have been edited by hand.
 */

/**
 * Trial length on every tier (owner decision: 7 days, docs/16 §7).
 * HAND-OFF (claude/rd-e12-trial): replace with the `TRIAL_DAYS` export of @mizan/shared (or
 * GET /v1/public/plans → trialDays) once it lands; the chip and the trial copy hide when it is 0.
 */
export const TRIAL_DAYS = 7;

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

/** What was typed before the connection dropped: the email and the method only, never a password or code. */
export const draft = {
  read(): { email?: string; method?: "email" | "phone" } | null {
    try {
      const o = JSON.parse(get("session", "mizan.auth.draft") ?? "null") as { email?: unknown; method?: unknown } | null;
      if (!o) return null;
      return {
        email: typeof o.email === "string" && o.email.length <= 254 ? o.email : undefined,
        method: o.method === "phone" || o.method === "email" ? o.method : undefined,
      };
    } catch { return null; }
  },
  save(d: { email?: string; method?: "email" | "phone" }): void { set("session", "mizan.auth.draft", JSON.stringify(d)); },
  clear(): void { remove("session", "mizan.auth.draft"); },
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
