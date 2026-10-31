"use client";

import { LEGAL_STATUS, LEGAL_VERSIONS } from "@mizan/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent, type ReactNode } from "react";
import { AuthFrame } from "@/components/AuthFrame";
import { Loading } from "@/components/auth/Gate";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Choice";
import { LegalLink } from "./LegalLink";
import { ok } from "@/lib/api/client";
import { isLegalVersionChanged, legalQueryKey, legalView, showLegalBanner, type LegalCheck } from "@/lib/legal";
import { useSession } from "@/lib/session";
import type { Theme } from "@/lib/theme";

/** The store's legal acceptance (GET /v1/tenant/legal), shared by the gate, the banner and Settings → Store. */
export function useStoreLegal() {
  const { api, user, store } = useSession();
  return useQuery({
    queryKey: legalQueryKey(user?.uid ?? "", store?.tenantId ?? ""),
    queryFn: () => ok(api.GET("/v1/tenant/legal")),
    enabled: Boolean(store),
    staleTime: 5 * 60_000,
    meta: { toast: false },
  });
}

function useLegalCheck(): LegalCheck {
  const q = useStoreLegal();
  return { needsAcceptance: q.data?.needsAcceptance, pending: q.isPending, error: q.isError };
}

/**
 * Once the documents are in force (LEGAL_STATUS "published"), an owner whose store has not
 * accepted the current terms and DPA sees this page instead of the store until they accept. The
 * rest of the team keeps working and sees LegalBanner. Never shown while the documents are drafts;
 * while the check runs the owner sees a loader (the store never flashes open first); if the check
 * fails, the store opens (the API is the record, not this screen). Decision: legalView.
 */
export function LegalGate({ theme, children }: { theme: Theme; children: ReactNode }) {
  const { store } = useSession();
  const view = legalView(store?.role, useLegalCheck(), LEGAL_STATUS === "published");
  if (view === "loading") return <Loading />;
  if (view === "gate") return <AuthFrame theme={theme}><Interstitial /></AuthFrame>;
  return <>{children}</>;
}

function Interstitial() {
  const t = useTranslations("legal");
  const locale = useLocale();
  const qc = useQueryClient();
  const { api, user, store, stores, selectStore, signOut } = useSession();
  const [agreed, setAgreed] = useState(false);
  const accept = useMutation({
    mutationFn: () => ok(api.POST("/v1/tenant/legal/accept", {
      body: { terms: LEGAL_VERSIONS.terms, dpa: LEGAL_VERSIONS.dpa, language: locale === "en" ? "en" : "ar" },
    })),
    onSuccess: (data) => qc.setQueryData(legalQueryKey(user?.uid ?? "", store?.tenantId ?? ""), data),
    meta: { toast: false }, // shown on the page
  });
  const changed = isLegalVersionChanged(accept.error);
  const onSubmit = (e: FormEvent) => { e.preventDefault(); if (agreed) accept.mutate(); };

  return (
    <section className="rounded-lg border border-line bg-surface p-5 sm:p-6" data-testid="legal-gate" aria-labelledby="legal-gate-title">
      <h1 id="legal-gate-title" className="font-display text-heading-md">{t("gate.title")}</h1>
      <p className="mt-1.5 text-body-sm text-text-2">{t.rich("gate.body", { store: store?.tenantName ?? "", b: (c) => <bdi className="font-medium text-text">{c}</bdi> })}</p>
      <ul className="mt-4 flex flex-col gap-1.5 text-body-sm">
        {(["terms", "dpa", "privacy"] as const).map((d) => (
          <li key={d}>
            <LegalLink doc={d}>{t("gate.read", { doc: t(`docs.${d}`) })}</LegalLink>
          </li>
        ))}
      </ul>
      <form onSubmit={onSubmit} className="mt-5 flex flex-col gap-4">
        <Checkbox required checked={agreed} onChange={(e) => setAgreed(e.target.checked)} data-testid="legal-gate-agree"
          label={<span className="text-body-sm">{t.rich("agree", { terms: (c) => <LegalLink doc="terms">{c}</LegalLink>, dpa: (c) => <LegalLink doc="dpa">{c}</LegalLink> })}</span>} />
        {changed ? <Alert tone="warning">{t("versionChanged")}</Alert> : accept.error ? <Alert tone="danger">{t("gate.error")}</Alert> : null}
        <Button type="submit" size="lg" busy={accept.isPending} disabled={!agreed}>{t("gate.accept")}</Button>
      </form>
      {/* A way out without accepting: another store, or sign out. */}
      <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4">
        {stores.length > 1 ? (
          <label className="flex flex-col gap-1.5 text-body-sm text-text-2">
            {t("gate.switchStore")}
            <select value={store?.tenantId ?? ""} onChange={(e) => selectStore(e.target.value)} data-testid="legal-gate-store"
              className="h-10 min-w-0 rounded-sm border border-line-strong bg-surface px-2.5 text-label text-text">
              {stores.map((s) => <option key={s.tenantId} value={s.tenantId}>{s.tenantName}</option>)}
            </select>
          </label>
        ) : null}
        <Button variant="ghost" onClick={() => void signOut()} data-testid="legal-gate-sign-out">{t("gate.signOut")}</Button>
      </div>
    </section>
  );
}

/** For everyone but the owner while the store's acceptance is missing: one line, nothing blocked. */
export function LegalBanner() {
  const t = useTranslations("legal");
  const { store } = useSession();
  if (!showLegalBanner(store?.role, useLegalCheck())) return null;
  return (
    <div role="status" data-testid="legal-banner" className="border-b border-warning bg-warning-soft px-4 py-2 text-body-sm text-warning-text md:px-6">
      {t("banner")}
    </div>
  );
}
