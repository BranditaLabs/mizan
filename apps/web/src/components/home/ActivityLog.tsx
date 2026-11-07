"use client";

import { rolesWith } from "@mizan/shared";
import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { CSSProperties } from "react";
import { PageState } from "@/components/ui/QueryState";
import { DateText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";

const AUDIT = rolesWith("audit.read");
const REFRESH_MS = 30_000;
const SHOWN = 8;
const ICON: Record<string, IconProps["name"]> = {
  member: "team", connection: "link", customer: "customer", store: "settings", support: "help", user: "locked", order: "orders",
  orders: "orders", payment: "payments", payments: "payments", refund: "refund", refunds: "refund", stock: "stock", po: "purchasing",
  supplier: "supplier", automation: "automations", shipment: "shipping", ticket: "returns", return: "returns", dispute: "chargeback",
  catalog: "product", picklist: "warehouse", ad_spend: "finance", cost_rule: "finance", fx: "fx", exchange: "transfer",
};
const order = (i: number) => ({ "--i": i }) as CSSProperties;

/**
 * What just happened in the store, newest first, refreshing every 30 seconds. Owners and admins see
 * the audit trail (who did what: invites, connections, refunds, stock, POs …); other roles see the
 * team's notifications. A new entry slides in at the top. Links to the full log.
 */
export function ActivityLog() {
  const t = useTranslations("profitHome.activity");
  const ta = useTranslations("auditLog");
  const { api, user, store } = useSession();
  const role = store?.role ?? "";
  const audit = AUDIT.has(role);
  const scope = [user?.uid ?? "", store?.tenantId ?? ""];
  const log = useQuery({
    queryKey: ["activity", ...scope, "audit"],
    queryFn: () => ok(api.GET("/v1/audit-log", { params: { query: { limit: SHOWN } } })),
    enabled: Boolean(store) && audit, refetchInterval: REFRESH_MS, meta: { toast: false },
  });
  const notes = useQuery({
    queryKey: ["activity", ...scope, "notifications"],
    queryFn: () => ok(api.GET("/v1/notifications")),
    enabled: Boolean(store) && !audit, refetchInterval: REFRESH_MS, meta: { toast: false },
  });

  const action = (a: string) => {
    const [family = "", ...rest] = a.split(".");
    const key = `actions.${family}.${rest.join("_")}`;
    if (ta.has(key as "title")) return ta(key as "title");
    return ta.has(`families.${family}` as "title") ? ta(`families.${family}` as "title") : a;
  };
  const actor = (a: { type: string; displayName: string | null }) =>
    a.type === "mizan_staff" ? ta("actor.mizan") : a.type === "user" ? (a.displayName ?? ta("actor.someone")) : ta.has(`actor.${a.type}` as "title") ? ta(`actor.${a.type}` as "title") : a.type;

  const rows = audit
    ? (log.data?.data ?? []).map((e) => ({ id: e.id, at: e.createdAt, icon: ICON[e.action.split(".")[0] ?? ""] ?? "note", title: action(e.action), who: actor(e.actor) }))
    : (notes.data?.data ?? []).slice(0, SHOWN).map((n) => ({ id: n.id, at: n.at, icon: ICON[n.source.split(".")[0] ?? ""] ?? "notification", title: n.text, who: null as string | null }));
  const feed = audit ? log : notes;

  return (
    <section className="mz-card flex flex-col gap-3 p-5 lg:col-span-2" aria-labelledby="activity-title" data-testid="activity">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="activity-title" className="flex items-center gap-2 text-heading-sm">
          {t("title")}
          {/* Live, quietly: a still ink dot (no ping, no red). */}
          <span className="inline-flex size-1.5 rounded-full bg-text" aria-hidden="true" />
        </h2>
        {audit ? <Link href="/settings/audit" className="text-body-sm text-text-2 hover:underline">{t("all")}</Link> : null}
      </div>
      {!feed.data ? <PageState query={feed} compact variant="card" label={t("loading")} />
        : rows.length === 0 ? <p className="text-body-sm text-text-2">{t("empty")}</p> : (
          <ol className="mz-stagger relative flex flex-col">
            {rows.map((r, i) => (
              <li key={r.id} className="relative flex items-start gap-3 py-2.5" style={order(i)}>
                {i < rows.length - 1 ? <span className="absolute start-[15px] top-9 bottom-0 w-px bg-line" aria-hidden="true" /> : null}
                <span className="z-[1] flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-sunk text-text-2">
                  <Icon name={r.icon} size={15} />
                </span>
                <div className="min-w-0 flex-1 text-body-sm">
                  <p className="font-medium text-text">{r.title}</p>
                  <p className="text-caption text-text-3">
                    {r.who ? <><bdi>{r.who}</bdi>{" · "}</> : null}
                    <DateText value={r.at} relative />
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
    </section>
  );
}
