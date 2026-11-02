"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { SkeletonRows } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { DateText } from "@/components/ui/Values";
import { ok } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";

type Circuit = { circuit?: { state?: string } } | undefined;
type Drift = { connector?: string; entity?: string; kind?: string; field?: string; detail?: string; count?: number; lastAt?: number };
const CIRCUIT_TONE: Record<string, BadgeTone> = { closed: "success", half_open: "warning", open: "danger" };
const CIRCUITS = new Set(["closed", "half_open", "open"]);

/**
 * The sync engine at a glance (docs/05 "Admin / integration ops"): whether each provider's circuit
 * is letting calls through, the queue, and the fields that changed shape (schema drift).
 */
export function EngineHealth() {
  const t = useTranslations("integrationsSettings.engine");
  const { api, user, store } = useSession();
  const q = useQuery({
    queryKey: ["integrationsHealth", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/admin/integrations/health")),
    refetchInterval: 30_000,
  });
  const h = q.data;
  const circuit = (name: string, c: unknown) => {
    const state = (c as Circuit)?.circuit?.state;
    if (!state) return null;
    return (
      <li className="flex items-center justify-between gap-2 py-1.5">
        <span>{name}</span>
        <Badge tone={CIRCUIT_TONE[state] ?? "neutral"}>{CIRCUITS.has(state) ? t(`circuit.${state as "open"}`) : state}</Badge>
      </li>
    );
  };
  const drift = (h?.drift ?? []) as Drift[];
  return (
    <section className="mz-card p-5" data-testid="engine-health">
      <h2 className="text-heading-sm">{t("title")}</h2>
      <p className="text-body-sm text-text-2">{t("subtitle")}</p>
      {q.isPending ? <SkeletonRows rows={2} label={t("loading")} /> : !h ? null : !h.connected ? (
        <p className="mt-2 text-body-sm text-text-2">{t("notConnected")}</p>
      ) : (
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <ul className="flex flex-col divide-y divide-line text-body-sm">
            {circuit(t("store"), h.shopify)}
            {circuit(t("courier"), h.bosta)}
            <li className="flex items-center justify-between gap-2 py-1.5"><span>{t("pending")}</span><Bdi>{h.outbox?.pending ?? 0}</Bdi></li>
            <li className="flex items-center justify-between gap-2 py-1.5">
              <span>{t("dead")}</span>
              <Badge tone={h.outbox?.dead ? "danger" : "success"}><Bdi>{h.outbox?.dead ?? 0}</Bdi></Badge>
            </li>
          </ul>
          <div>
            <h3 className="text-label">{t("drift")}</h3>
            {drift.length === 0 ? <p className="mt-1 text-body-sm text-text-2">{t("noDrift")}</p> : (
              <ul className="mt-1 flex flex-col divide-y divide-line text-body-sm" data-testid="drift">
                {drift.map((d, i) => (
                  <li key={i} className="flex flex-col gap-0.5 py-1.5">
                    <span><bdi dir="ltr" className="mz-id">{[d.connector, d.entity, d.field].filter(Boolean).join(" · ")}</bdi></span>
                    {d.detail ? <span className="text-caption text-text-2"><bdi dir="ltr">{d.detail}</bdi></span> : null}
                    <span className="text-caption text-text-3">
                      {t("times", { n: d.count ?? 1 })}
                      {d.lastAt ? <>{" · "}<DateText value={new Date(d.lastAt).toISOString()} relative /></> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/** The city the courier did not recognise, from the dead letter's message (the engine names it in quotes). */
export function unknownCity(error: string | null): string | null {
  if (!error || !/not recognised by Bosta/i.test(error)) return null;
  const m = /city "([^"]*)" \/ "([^"]*)"/.exec(error);
  return m ? (m[1] || m[2] || "").trim() || null : null;
}

/**
 * Pick the courier's city for an address it could not match. Mizan remembers the choice for every
 * later order with the same text, and sends the stuck shipment again.
 */
export function ResolveCityDialog({ jobId, text, onClose }: { jobId: string; text: string; onClose(): void }) {
  const t = useTranslations("integrationsSettings.city");
  const tpr = useTranslations("problem");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState(text);
  const [q, setQ] = useState(text);
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);
  const cities = useQuery({
    queryKey: ["courierCities", user?.uid ?? "", store?.tenantId ?? "", q],
    queryFn: () => ok(api.GET("/v1/admin/integrations/cities", { params: { query: { ...(q ? { q } : {}), limit: 8 } } })),
    meta: { toast: false },
  });
  const save = useMutation({
    mutationFn: () => ok(api.POST("/v1/admin/integrations/cities/resolve", { body: { text, cityId: picked!, jobId } })),
    meta: { toast: false },
    onSuccess: () => {
      toast({ message: t("saved") });
      void qc.invalidateQueries({ queryKey: ["deadLetters"] });
      void qc.invalidateQueries({ queryKey: ["integrationsHealth"] });
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title={t("title")} description={t.rich("body", { text, b: (c) => <bdi className="font-medium text-text">{c}</bdi> })} footer={(
      <>
        <Button variant="secondary" onClick={onClose}>{t("cancel")}</Button>
        <Button busy={save.isPending} disabled={!picked} onClick={() => save.mutate()}>{t("save")}</Button>
      </>
    )}>
      <div className="flex flex-col gap-3">
        <Field label={t("search")} value={search} onChange={(e) => setSearch(e.target.value)} dir="auto" />
        {cities.isError ? <Alert tone="danger">{problemText(cities.error, tpr)}</Alert> : null}
        {cities.isPending ? <SkeletonRows rows={3} label={t("loading")} /> : null}
        <div role="radiogroup" aria-label={t("pick")} className="flex flex-col gap-1" data-testid="courier-cities">
          {(cities.data?.data ?? []).map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-3 rounded-md border border-line px-3 py-2 has-[:checked]:border-text">
              <input type="radio" name="city" value={c.id} checked={picked === c.id} onChange={() => setPicked(c.id)} />
              <span className="flex flex-col">
                <span>{c.name}</span>
                {c.nameAr ? <span className="text-caption text-text-2" lang="ar">{c.nameAr}</span> : null}
              </span>
            </label>
          ))}
        </div>
        {save.isError ? <Alert tone="danger">{problemText(save.error, tpr)}</Alert> : null}
      </div>
    </Dialog>
  );
}
