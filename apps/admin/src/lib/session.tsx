"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { onIdTokenChanged, signOut as firebaseSignOut, type User } from "firebase/auth";
import { useLocale } from "next-intl";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiClient, ApiError, ok, type ApiClient, type Schemas, type StaffRole } from "./api/client";
import { authConfigured, firebaseAuth } from "./firebase";

/**
 * Who is signed in to the back office, and whether they are Mizan staff (GET /v1/platform/me).
 * The API decides: a second factor, active staff, a role. The screens only hide what a role
 * cannot do; the API refuses it anyway.
 */
export type StaffCheck = "idle" | "checking" | "ok" | "not_staff" | "mfa_required" | "staff_disabled" | "user_disabled" | "unavailable";

export interface Session {
  status: "loading" | "signed-out" | "signed-in";
  user: User | null;
  staff: Schemas["StaffMe"] | null;
  check: StaffCheck;
  api: ApiClient;
  can(...roles: StaffRole[]): boolean;
  retry(): void;
  signOut(): Promise<void>;
}

const Ctx = createContext<Session | null>(null);
const REFUSALS = new Set<StaffCheck>(["not_staff", "mfa_required", "staff_disabled", "user_disabled"]);

export function SessionProvider({ children }: { children: ReactNode }) {
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null | undefined>(authConfigured ? undefined : null);

  useEffect(() => {
    const auth = firebaseAuth();
    return auth ? onIdTokenChanged(auth, (u) => setUser(u)) : undefined;
  }, []);

  const api = useMemo(() => apiClient(user ?? null, locale), [user, locale]);
  const me = useQuery({
    queryKey: ["staff-me", user?.uid ?? ""],
    queryFn: () => ok(api.GET("/v1/platform/me")),
    enabled: Boolean(user),
    retry: false,
    meta: { toast: false },
  });

  const code = me.error instanceof ApiError ? (me.error.code as StaffCheck) : null;
  const check: StaffCheck = !user ? "idle" : me.isSuccess ? "ok" : me.isError ? (code && REFUSALS.has(code) ? code : "unavailable") : "checking";
  const staff = me.data ?? null;

  const can = useCallback((...roles: StaffRole[]) => Boolean(staff && roles.includes(staff.role)), [staff]);
  const refetch = me.refetch;
  const retry = useCallback(() => void refetch(), [refetch]);
  const signOut = useCallback(async () => {
    const auth = firebaseAuth();
    if (auth) await firebaseSignOut(auth);
    queryClient.clear();
  }, [queryClient]);

  const value: Session = { status: user === undefined ? "loading" : user ? "signed-in" : "signed-out", user: user ?? null, staff, check, api, can, retry, signOut };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession outside SessionProvider");
  return s;
}
