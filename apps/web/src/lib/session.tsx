"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { onIdTokenChanged, signOut as firebaseSignOut, type User } from "firebase/auth";
import { useLocale } from "next-intl";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiClient, ApiError, ok, type ApiClient, type Me, type Membership } from "./api/client";
import { authConfigured, firebaseAuth } from "./firebase";

/**
 * Who is signed in, which stores they can open, and the store they are in.
 *
 *   loading → signed-out | signed-in
 *   signed-in: me (GET /v1/me) → store chosen (remembered per user) → store checked with the API
 *   (GET /v1/tenant), which is where an owner without two-step verification learns it (mfa_required).
 *
 * Both reads are TanStack queries keyed by person (and store), so another person or store never
 * sees a stale answer; sign-out clears the cache. `api` is the typed client for the current store.
 */
export type StoreCheck = "idle" | "checking" | "ok" | "mfa_required" | "unavailable";

export interface Session {
  status: "loading" | "signed-out" | "signed-in";
  user: User | null;
  me: Me | null;
  meError: ApiError | null;
  /** Active memberships in open stores (trial or active): the stores this user can open. */
  stores: Membership[];
  store: Membership | null;
  storeCheck: StoreCheck;
  /** Typed API client for this person, language and store. */
  api: ApiClient;
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
const OPEN_STORE = new Set<Membership["tenantStatus"]>(["trial", "active"]);

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

export const queryKeys = {
  me: (uid: string) => ["me", uid] as const,
  tenant: (uid: string, tenantId: string) => ["tenant", uid, tenantId] as const,
};

export function SessionProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const queryClient = useQueryClient();
  // undefined until Firebase reports; null when signed out (or sign-in is not configured).
  const [user, setUser] = useState<User | null | undefined>(authConfigured ? undefined : null);
  const [chosen, setChosen] = useState<{ uid: string; tenantId: string } | null>(null);

  useEffect(() => {
    const auth = firebaseAuth();
    return auth ? onIdTokenChanged(auth, (u) => setUser(u)) : undefined;
  }, []);

  const uid = user?.uid ?? "";
  const base = useMemo(() => apiClient({ user: user ?? null, locale }), [user, locale]);
  const meQuery = useQuery({
    queryKey: queryKeys.me(uid),
    queryFn: () => ok(base.GET("/v1/me")),
    enabled: Boolean(user),
    meta: { toast: false },
  });

  const me = meQuery.data ?? null;
  const stores = useMemo(() => (me?.memberships ?? []).filter((m) => m.status === "active" && OPEN_STORE.has(m.tenantStatus)), [me]);
  const chosenId = chosen?.uid === uid ? chosen.tenantId : uid ? remembered(uid) : null;
  const store = stores.find((s) => s.tenantId === chosenId) ?? stores[0] ?? null;

  const tenantQuery = useQuery({
    queryKey: queryKeys.tenant(uid, store?.tenantId ?? ""),
    queryFn: () => ok(base.GET("/v1/tenant", { headers: { "X-Tenant-Id": store!.tenantId } })),
    enabled: Boolean(user && store),
    meta: { toast: false },
  });
  const storeCheck: StoreCheck = !user || !store ? "idle"
    : tenantQuery.isSuccess ? "ok"
    : tenantQuery.isError ? (tenantQuery.error instanceof ApiError && tenantQuery.error.code === "mfa_required" ? "mfa_required" : "unavailable")
    : "checking";

  const api = useMemo(() => apiClient({ user: user ?? null, locale, tenantId: store?.tenantId ?? null }), [user, locale, store?.tenantId]);

  const selectStore = useCallback((tenantId: string) => {
    if (!uid) return;
    remember(uid, tenantId);
    setChosen({ uid, tenantId });
  }, [uid]);

  const refetchMe = meQuery.refetch;
  const refetchTenant = tenantQuery.refetch;
  const refreshMe = useCallback(async () => (await refetchMe()).data ?? null, [refetchMe]);
  const retry = useCallback(() => {
    void refetchMe();
    void refetchTenant();
  }, [refetchMe, refetchTenant]);

  const signOutTarget = useRef<string | null>(null);
  const signOut = useCallback(async (to = "/sign-in") => {
    const auth = firebaseAuth();
    signOutTarget.current = to;
    if (auth) await firebaseSignOut(auth);
    queryClient.clear(); // nothing of this person stays in memory
  }, [queryClient]);
  const takeSignOutTarget = useCallback(() => {
    const to = signOutTarget.current;
    signOutTarget.current = null;
    return to;
  }, []);

  const meError = meQuery.error instanceof ApiError ? meQuery.error : meQuery.error ? new ApiError(0, "unknown", "") : null;
  const value: Session = {
    status: user === undefined ? "loading" : user ? "signed-in" : "signed-out",
    user: user ?? null, me, meError, stores, store, storeCheck, api, selectStore, refreshMe, retry, signOut, takeSignOutTarget,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}

/** The typed API client for the current person and store (screens use it in queryFn / mutationFn). */
export function useApi(): ApiClient {
  return useSession().api;
}
