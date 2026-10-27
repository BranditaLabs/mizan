"use client";

import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";

const TONE = {
  critical: "border-danger bg-danger-soft text-danger-text",
  warning: "border-warning bg-warning-soft text-warning-text",
  info: "border-info bg-info-soft text-info-text",
} as const;
const key = (id: string) => `mizan-announcement:${id}`;

/**
 * Announcements from Mizan (A-6): one line each across the dashboard, in the dashboard's language,
 * most serious first. Info and warnings can be hidden on this device; critical ones stay until they end.
 */
export function AnnouncementsBanner() {
  const t = useTranslations("announcements");
  const locale = useLocale();
  const { api, user, store } = useSession();
  const [hidden, setHidden] = useState<string[]>([]);
  const q = useQuery({
    queryKey: ["announcements", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/announcements")),
    enabled: Boolean(store),
    staleTime: 5 * 60_000,
    meta: { toast: false },
  });
  const isHidden = (id: string) => {
    if (hidden.includes(id)) return true;
    try { return localStorage.getItem(key(id)) === "1"; } catch { return false; }
  };
  const shown = (q.data?.data ?? []).filter((a) => a.level === "critical" || !isHidden(a.id));
  if (!store || !shown.length) return null;
  const hide = (id: string) => {
    try { localStorage.setItem(key(id), "1"); } catch { /* storage blocked: hide for now only */ }
    setHidden((h) => [...h, id]);
  };
  return (
    <div data-testid="announcements">
      {shown.map((a) => {
        const title = locale === "en" ? a.titleEn : a.titleAr;
        const body = locale === "en" ? a.bodyEn : a.bodyAr;
        return (
          <div key={a.id} role={a.level === "critical" ? "alert" : "status"} className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2 text-body-sm md:px-6 ${TONE[a.level]}`}>
            <span className="font-medium">{title}</span>
            {body && <span>{body}</span>}
            {a.link && <a href={a.link} target="_blank" rel="noopener noreferrer" className="font-medium underline">{t("more")}</a>}
            {a.level !== "critical" && <button type="button" className="ms-auto underline" onClick={() => hide(a.id)}>{t("hide")}</button>}
          </div>
        );
      })}
    </div>
  );
}
