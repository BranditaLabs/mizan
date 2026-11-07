"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider, type Mutation, type Query } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { OutageScreen } from "@/components/OutageScreen";
import { useToast } from "@/components/ui/Toast";
import { isOutage, useOutage } from "../outage";
import { useEventMotion, type OwnSuccess } from "../motion/EventMotionProvider";
import type { MotionMeta } from "../motion/useEventMutation";
import { ApiError } from "./client";

/**
 * TanStack Query for the dashboard (E4-4).
 *
 * Retries: only what may succeed on its own (no answer, 5xx, 429, an expired token after a
 * refresh), at most twice with backoff; never 4xx. Creates carry an idempotency key, so retrying
 * a POST is safe.
 * Errors: a failed action (mutation) shows a toast with the API's problem title (already in the
 * user's language); queries show their error in place (screens decide), except a background
 * refresh of data already on screen, which toasts once. `meta: { toast: false }` opts out.
 */
export function shouldRetry(failures: number, error: unknown): boolean {
  if (failures >= 2) return false;
  if (!(error instanceof ApiError)) return false;
  return error.status === 0 || error.status >= 500 || error.status === 429 || error.code === "token_expired";
}

export const retryDelay = (attempt: number) => Math.min(500 * 2 ** attempt, 4000);

/** What a person reads for an error: the API's title, or ours when there was no usable answer. */
export function problemText(error: unknown, t: (key: "network" | "generic") => string): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return t("network");
    if (error.title) return error.title;
  }
  return t("generic");
}

/**
 * A mutation that names its catalogue event (useEventMutation, `meta.motion`) → what its success
 * hands the motion provider: the event, the entity it touched and the non-PII facts its variant reads.
 */
export function successMotion(meta: MotionMeta | undefined, data: unknown, variables: unknown): OwnSuccess | null {
  if (!meta) return null;
  const message = meta.message?.(data, variables);
  return {
    type: typeof meta.type === "function" ? meta.type(data, variables) : meta.type,
    ...(meta.entityId ? { entityId: meta.entityId(data, variables) } : {}),
    ...(meta.data ? { data: meta.data(data, variables) } : {}),
    ...(message !== undefined && message !== null ? { message } : {}),
    ...(meta.toast === false ? { toast: false } : {}),
  };
}

/**
 * `outage` hears every final failure first; an outage (lib/outage) shows the waiting screen instead of a toast.
 * `success` hears every mutation that named its event (the event-motion provider plays the outcome).
 */
export function makeQueryClient(notify: (error: unknown) => void, outage?: (error: unknown) => void, success?: (s: OwnSuccess) => void): QueryClient {
  const down = (error: unknown) => { outage?.(error); return Boolean(outage) && isOutage(error); };
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query: Query<unknown, unknown, unknown, readonly unknown[]>) => {
        if (down(error)) return;
        if (query.meta?.toast !== false && query.state.data !== undefined) notify(error);
      },
    }),
    mutationCache: new MutationCache({
      onSuccess: (data, variables, _c, mutation: Mutation<unknown, unknown, unknown, unknown>) => {
        const s = successMotion(mutation.meta?.motion, data, variables);
        if (s) success?.(s);
      },
      onError: (error, _v, _c, mutation: Mutation<unknown, unknown, unknown, unknown>) => {
        if (down(error)) return;
        if (mutation.meta?.toast !== false) notify(error);
      },
    }),
    defaultOptions: {
      queries: { staleTime: 30_000, retry: shouldRetry, retryDelay },
      mutations: { retry: shouldRetry, retryDelay },
    },
  });
}

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: { toast?: boolean };
    mutationMeta: { toast?: boolean; motion?: MotionMeta };
  }
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const t = useTranslations("problems");
  const { report } = useOutage();
  const motion = useEventMotion();
  // A failed action plays the catalogue's "fail" (tips twice, rests in the danger tone).
  const [client] = useState(() => makeQueryClient((error) => toast({ message: problemText(error, (k) => t(k)), outcome: "fail" }), report, (s) => motion.ownSuccess(s)));
  return (
    <QueryClientProvider client={client}>
      {children}
      <OutageScreen />
    </QueryClientProvider>
  );
}
