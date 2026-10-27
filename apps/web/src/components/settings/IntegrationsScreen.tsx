"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { Bdi } from "@/components/Bdi";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { DateText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { SettingsTabs } from "./SettingsTabs";

const READERS = new Set(["owner", "admin", "ops_manager"]);
const TONE: Record<string, BadgeTone> = { active: "success", pending: "info", needs_attention: "danger", disconnected: "neutral" };

/**
 * Settings → Integrations (A-8, on E2-5 and E3): every connection and its state with the reason
 * when it needs attention, where to fix it, and the jobs that need a person (replay once fixed).
 */
export function IntegrationsScreen() {
  const t = useTranslations("integrationsSettings");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const role = store?.role ?? "";
  const scope = [user?.uid ?? "", store?.tenantId ?? ""];
  const list = useQuery({ queryKey: ["connections", ...scope], queryFn: () => ok(api.GET("/v1/connections")), enabled: READERS.has(role) });
  const dead = useQuery({ queryKey: ["deadLetters", ...scope], queryFn: () => ok(api.GET("/v1/admin/integrations/dead-letters", { params: { query: { limit: 50 } } })), enabled: READERS.has(role) });
  const replay = useMutation({
    mutationFn: (id: string) => ok(api.POST("/v1/admin/integrations/jobs/{id}/replay", { params: { path: { id } } })),
    onSuccess: () => { toast({ message: t("replayed") }); void qc.invalidateQueries({ queryKey: ["deadLetters"] }); },
  });
  const fixHref = (provider: string) => provider === "shopify" ? "/onboarding" : provider === "bosta" ? "/onboarding" : provider === "meta_whatsapp" || provider === "whatsapp" ? "/settings/confirmation" : null;

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-5 px-4 pt-6 pb-14 md:px-6" data-testid="integrations-settings">
      <SettingsTabs />
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{t("subtitle")}</p>
      </header>
      {!READERS.has(role) ? <div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div>
        : !list.data ? <div className="mz-card"><SkeletonRows rows={3} label={t("loading")} /></div>
        : (
          <>
            {list.data.data.length ? (
              <ul className="flex flex-col gap-3" data-testid="connections">
                {list.data.data.map((c) => {
                  const href = c.status !== "active" ? fixHref(c.provider) : null;
                  return (
                    <li key={c.id} className="mz-card flex flex-wrap items-start justify-between gap-3 p-4">
                      <div>
                        <p className="font-medium">{t.has(`providers.${c.provider}`) ? t(`providers.${c.provider}` as "providers.shopify") : c.provider} <Bdi code>{c.account ?? ""}</Bdi></p>
                        {c.reason ? <p className="text-body-sm text-danger-text">{t.has(`reasons.${c.reason}`) ? t(`reasons.${c.reason}` as "reasons.key_refused") : c.reason}</p> : null}
                        {c.missingScopes.length ? <p className="text-caption text-text-2">{t("missingScopes")} <Bdi code>{c.missingScopes.join(", ")}</Bdi></p> : null}
                        <p className="text-caption text-text-2">{t("updated")} <DateText value={c.updatedAt} relative /></p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={TONE[c.status] ?? "neutral"}>{t(`status.${c.status}`)}</Badge>
                        {href ? <Link href={href} className="text-body-sm font-medium underline">{t("fix")}</Link> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : <div className="mz-card"><EmptyState icon="link" title={t("none.title")} body={t("none.body")} action={<Link href="/onboarding" className="font-medium underline">{t("none.action")}</Link>} /></div>}
            <section className="mz-card p-5">
              <h2 className="text-heading-sm">{t("dead.title")}</h2>
              <p className="text-body-sm text-text-2">{t("dead.subtitle")}</p>
              {dead.data?.data.length ? (
                <ul className="mt-3 flex flex-col divide-y divide-line" data-testid="dead-letters">
                  {dead.data.data.map((j) => (
                    <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <p className="font-medium"><Bdi code>{j.kind}</Bdi></p>
                        <p className="truncate text-caption text-text-2"><Bdi>{j.error ?? ""}</Bdi></p>
                      </div>
                      <span className="flex items-center gap-2 text-caption text-text-2">
                        <DateText value={j.failedAt} relative />
                        <Button size="sm" variant="secondary" busy={replay.isPending && replay.variables === j.id} onClick={() => replay.mutate(j.id)}>{t("dead.replay")}</Button>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-body-sm text-text-2">{t("dead.none")}</p>}
            </section>
          </>
        )}
    </div>
  );
}
