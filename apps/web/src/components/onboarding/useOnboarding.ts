"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";

export type Onboarding = Schemas["Onboarding"];
export type StepKey = keyof Onboarding["steps"];
export const STEP_ORDER: readonly StepKey[] = ["store", "courier", "costs", "firstOrder"];

/** A step counts as finished when done or skipped (a store may use another courier). */
export const finished = (o: Onboarding, step: StepKey) => ["done", "skipped"].includes(o.steps[step].status);

/** Something is moving on the server: the import, a key check, or the first order on its way. */
const moving = (o: Onboarding | undefined) => Boolean(o && (
  o.steps.store.import?.status === "running" || o.steps.courier.status === "checking"
  || (o.steps.store.status === "done" && o.steps.firstOrder.status === "waiting")
));

/** Setup is for owners and admins (the API refuses the others). */
export function useCanSetUp(): boolean {
  const { store } = useSession();
  return store?.role === "owner" || store?.role === "admin";
}

export const onboardingKey = (uid: string | undefined, tenantId: string | undefined) => ["onboarding", uid ?? "", tenantId ?? ""] as const;

/** GET /v1/onboarding, refreshed every 3 s while something is moving. */
export function useOnboarding() {
  const { api, user, store } = useSession();
  const can = useCanSetUp();
  return useQuery({
    queryKey: onboardingKey(user?.uid, store?.tenantId),
    queryFn: () => ok(api.GET("/v1/onboarding")),
    enabled: Boolean(store) && can,
    refetchInterval: (q) => (moving(q.state.data) ? 3000 : false),
  });
}

/** PATCH /v1/onboarding (skip a step, hide the card); the answer replaces the cached state. */
export function useUpdateOnboarding() {
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["UpdateOnboarding"]) => ok(api.PATCH("/v1/onboarding", { body })),
    onSuccess: (o) => qc.setQueryData(onboardingKey(user?.uid, store?.tenantId), o),
  });
}

/** Refetch the onboarding state now (after connecting, saving costs …). */
export function useRefreshOnboarding() {
  const { user, store } = useSession();
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: onboardingKey(user?.uid, store?.tenantId) });
}
