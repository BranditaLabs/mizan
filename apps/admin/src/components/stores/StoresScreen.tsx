"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { SearchInput, Select } from "@/components/ui/Field";
import { When } from "@/components/ui/When";
import { Link } from "@/i18n/navigation";
import { ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { StoreStatus } from "./StoreStatus";

const PLANS = ["free", "growth", "scale", "enterprise"] as const;
const STATUSES = ["trial", "active", "suspended", "deleted"] as const;
const PAGE = 50;

/** A-2: find a store by name, slug or id; filter by plan, status and country; newest or busiest first. */
export function StoresScreen() {
  const t = useTranslations("stores");
  const { api } = useSession();
  const [q, setQ] = useState("");
  const [plan, setPlan] = useState("");
  const [status, setStatus] = useState("");
  const [country, setCountry] = useState("");
  const [sort, setSort] = useState<"newest" | "orders">("newest");
  const [offset, setOffset] = useState(0);
  const query = {
    ...(q.trim() ? { q: q.trim() } : {}), ...(plan ? { plan: plan as (typeof PLANS)[number] } : {}),
    ...(status ? { status: status as (typeof STATUSES)[number] } : {}), ...(country ? { country } : {}), sort, limit: PAGE, offset,
  };
  const list = useQuery({
    queryKey: ["stores", query],
    queryFn: () => ok(api.GET("/v1/platform/stores", { params: { query } })),
    placeholderData: keepPreviousData,
  });
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setOffset(0); };

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="text-body-sm text-text-2">{t("subtitle")}</p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <SearchInput label={t("search")} placeholder={t("search")} value={q} onChange={(e) => reset(setQ)(e.target.value)} className="lg:col-span-2" />
        <Select label={t("plan")} value={plan} onChange={(e) => reset(setPlan)(e.target.value)}>
          <option value="">{t("any")}</option>
          {PLANS.map((p) => <option key={p} value={p}>{t(`plans.${p}`)}</option>)}
        </Select>
        <Select label={t("statusLabel")} value={status} onChange={(e) => reset(setStatus)(e.target.value)}>
          <option value="">{t("anyOpen")}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`status.${s}`)}</option>)}
        </Select>
        <Select label={t("country")} value={country} onChange={(e) => reset(setCountry)(e.target.value)}>
          <option value="">{t("any")}</option>
          {["EG", "SA", "AE", "KW", "QA", "BH", "OM"].map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-body-sm text-text-2" role="status">{list.data ? t.rich("count", { n: list.data.total, b: (c) => <Bdi>{c}</Bdi> }) : null}</p>
        <Select label={t("sort")} value={sort} onChange={(e) => reset(setSort)(e.target.value as "newest")}>
          <option value="newest">{t("sortNewest")}</option>
          <option value="orders">{t("sortOrders")}</option>
        </Select>
      </div>
      {list.isError ? <Alert tone="danger">{t("loadFailed")}</Alert> : null}
      <div className="mz-table-wrap">
        <table className="mz-table" data-testid="stores-table">
          <thead>
            <tr>
              <th>{t("col.name")}</th><th>{t("col.country")}</th><th>{t("col.plan")}</th><th>{t("col.status")}</th>
              <th>{t("col.members")}</th><th>{t("col.integrations")}</th><th>{t("col.orders")}</th><th>{t("col.created")}</th>
            </tr>
          </thead>
          <tbody>
            {(list.data?.data ?? []).map((s) => (
              <tr key={s.id}>
                <td><Link href={`/stores/${s.id}`} className="font-medium underline-offset-2 hover:underline">{s.name}</Link><div className="text-caption text-text-2"><Bdi code>{s.slug}</Bdi></div></td>
                <td><Bdi>{s.country}</Bdi></td>
                <td>{t(`plans.${s.plan}`)}</td>
                <td><StoreStatus status={s.status} /></td>
                <td><Bdi>{s.members}</Bdi></td>
                <td>{s.connections.needsAttention ? <span className="text-danger-text">{t("attention", { n: s.connections.needsAttention, total: s.connections.total })}</span> : <Bdi>{s.connections.total}</Bdi>}</td>
                <td>{s.lastMonth ? <Bdi>{s.lastMonth.orders}</Bdi> : <span className="text-text-3">—</span>}</td>
                <td><When value={s.createdAt} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.data && !list.data.data.length ? <p className="text-body-sm text-text-2">{t("empty")}</p> : null}
      <div className="flex gap-2">
        {offset > 0 ? <Button variant="secondary" onClick={() => setOffset(Math.max(0, offset - PAGE))}>{t("previous")}</Button> : null}
        {list.data?.nextOffset != null ? <Button variant="secondary" onClick={() => setOffset(list.data!.nextOffset!)}>{t("next")}</Button> : null}
      </div>
    </div>
  );
}
