"use client";

import { onIdTokenChanged, signOut as firebaseSignOut, type User } from "firebase/auth";
import { useLocale } from "next-intl";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, type Me, type Membership } from "./api";
import { authConfigured, firebaseAuth } from "./firebase";

/**
 * Who is signed in, which stores they can open, and the store they are in.
 *
 *   loading → signed-out | signed-in
 *   signed-in: me (GET /v1/me) → store chosen (remembered per user) → store checked with the API
 *   (GET /v1/tenant), which is where an owner without two-step verification learns it (mfa_required).
 *
 * Results are kept with the key they answer (user, store, attempt), so a stale answer is never
 * shown for another person or store, and nothing has to be reset when they change.
 */
export type StoreCheck = "idle" | "checking" | "ok" | "mfa_required" | "unavailable";

export interface Session {
  status: "loading" | "signed-out" | "signed-in";
  user: User | null;
  me: Me | null;
  meError: ApiError | null;
  /** Active memberships only: the stores this user can open. */
  stores: Membership[];
  store: Membership | null;
  storeCheck: StoreCheck;
  selectStore(tenantId: string): void;
  refreshMe(): Promise<Me | null>;
  /** After "unavailable": load /me and check the store again. */
  retry(): void;
  /** Sign out; the gates then go to `to` (default: sign-in) instead of "sign in and come back here". */
  signOut(to?: string): Promise<void>;
  /** For the gates: where a deliberate sign-out asked to go (once), or null when the session just ended. */
  takeSignOutTarget(): string | null;
}

const Ctx = createContext<Session | null>(null);
const storeKey = (uid: string) => `mizan-store:${uid}`;

function remembered(uid: string): string | null {
  try {
    return localStorage.getItem(storeKey(uid));
  } catch {
    return null;
  }
}
function remember(uid: string, tenantId: string) {
  try {
    localStorage.setItem(storeKey(uid), tenantId);
  } catch {
    /* private mode: the first store is chosen next time */
  }
}

type Keyed<T> = { key: string; value: T };
type MeResult = Keyed<{ me: Me | null; error: ApiError | null }>;

async function loadMe(user: User, locale: string): Promise<MeResult> {
  try {
    return { key: user.uid, value: { me: await api<Me>(user, "/me", { locale }), error: null } };
  } catch (e) {
    return { key: user.uid, value: { me: null, error: e instanceof ApiError ? e : new ApiError(0, "unknown", "") } };
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();
  // undefined until Firebase reports; null when signed out (or sign-in is not configured).
  const [user, setUser] = useState<User | null | undefined>(authConfigured ? undefined : null);
  const [meState, setMeState] = useState<MeResult | null>(null);
  const [chosen, setChosen] = useState<Keyed<string> | null>(null);
  const [check, setCheck] = useState<Keyed<StoreCheck> | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const auth = firebaseAuth();
    return auth ? onIdTokenChanged(auth, (u) => setUser(u)) : undefined;
  }, []);

  const uid = user?.uid ?? "";
  const refreshMe = useCallback(async () => {
    if (!user) return null;
    const result = await loadMe(user, locale);
    setMeState(result);
    return result.value.me;
  }, [user, locale]);

  // Load /me when the person changes (sign-in, sign-out, another account).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void loadMe(user, locale).then((r) => !cancelled && setMeState(r));
    return () => {
      cancelled = true;
    };
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps -- reload only when the person changes

  const mine = meState?.key === uid ? meState.value : null;
  const me = mine?.me ?? null;
  const stores = useMemo(() => (me?.memberships ?? []).filter((m) => m.status === "active" && m.tenantStatus === "active"), [me]);
  const chosenId = chosen?.key === uid ? chosen.value : uid ? remembered(uid) : null;
  const store = stores.find((s) => s.tenantId === chosenId) ?? stores[0] ?? null;

  // Check the store with the API whenever it (or the person, or a retry) changes.
  const checkKey = user && store ? `${uid}:${store.tenantId}:${attempt}` : "";
  useEffect(() => {
    if (!user || !store || !checkKey) return;
    let cancelled = false;
    api(user, "/tenant", { locale, tenantId: store.tenantId }).then(
      () => !cancelled && setCheck({ key: checkKey, value: "ok" }),
      (e) => !cancelled && setCheck({ key: checkKey, value: e instanceof ApiError && e.code === "mfa_required" ? "mfa_required" : "unavailable" }),
    );
    return () => {
      cancelled = true;
    };
  }, [checkKey, locale]); // eslint-disable-line react-hooks/exhaustive-deps -- checkKey names the user and store
  const storeCheck: StoreCheck = !checkKey ? "idle" : check?.key === checkKey ? check.value : "checking";

  const selectStore = useCallback((tenantId: string) => {
    if (!uid) return;
    remember(uid, tenantId);
    setChosen({ key: uid, value: tenantId });
  }, [uid]);

  const retry = useCallback(() => {
    setAttempt((n) => n + 1);
    void refreshMe();
  }, [refreshMe]);

  const signOutTarget = useRef<string | null>(null);
  const signOut = useCallback(async (to = "/sign-in") => {
    const auth = firebaseAuth();
    signOutTarget.current = to;
    if (auth) await firebaseSignOut(auth);
  }, []);
  const takeSignOutTarget = useCallback(() => {
    const to = signOutTarget.current;
    signOutTarget.current = null;
    return to;
  }, []);

  const value: Session = {
    status: user === undefined ? "loading" : user ? "signed-in" : "signed-out",
    user: user ?? null, me, meError: mine?.error ?? null, stores, store, storeCheck, selectStore, refreshMe, retry, signOut, takeSignOutTarget,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}
