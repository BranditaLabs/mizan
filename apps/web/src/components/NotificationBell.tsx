"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { Bdi } from "@/components/Bdi";
import { buttonClass } from "@/components/ui/Button";
import { DateText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";

type Note = Schemas["NotificationList"]["data"][number];

/** Where a notification leads: its order, the stock screen, or the automation. */
function hrefOf(n: Note): string | null {
  if (!n.entity) return null;
  if (n.entity.type === "order") return `/orders/${n.entity.id}`;
  if (n.entity.type === "variant") return "/stock";
  if (n.entity.type === "automation") return "/automations";
  if (n.entity.type === "plan") return "/settings/usage";
  return null;
}

/**
 * The team's notifications (E11-2): what automations (notify.team) and alerts send to the
 * caller's role. A bell with the unread count; the panel lists the latest, each linking to what
 * it is about; opening it marks them read. Checked every minute.
 */
export function NotificationBell() {
  const t = useTranslations("notifications");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const key = ["notifications", user?.uid ?? "", store?.tenantId ?? ""];
  const q = useQuery({ queryKey: key, queryFn: () => ok(api.GET("/v1/notifications", { params: { query: { limit: 20 } } })), enabled: Boolean(store), refetchInterval: 60_000 });
  const markAll = useMutation({
    mutationFn: () => ok(api.POST("/v1/notifications/read", { body: { all: true } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", esc); };
  }, [open]);

  if (!store) return null;
  const unread = q.data?.unread ?? 0;
  const label = unread ? t("labelUnread", { count: unread }) : t("label");
  const text = (n: Note) => {
    if (n.source === "automation.paused") return t("paused", { name: n.text });
    if (n.source === "plan.limit") {
      // "orders|near|240|300|free": the store's plan limit (E12-1), told in the reader's language.
      const [metric, level, used, limit] = n.text.split("|");
      if ((metric === "orders" || metric === "stores" || metric === "users") && (level === "near" || level === "over")) return t(`plan.${metric}_${level}`, { used: used ?? "", limit: limit ?? "" });
    }
    return n.text;
  };
  return (
    <div className="relative" ref={box}>
      <button ref={button} type="button" aria-label={label} title={label} aria-expanded={open} aria-controls={id}
        className={buttonClass("ghost", "md", "mz-btn--icon relative")} onClick={() => { setOpen((o) => !o); if (!open && unread) markAll.mutate(); }}>
        <Icon name="notification" size={18} />
        {unread ? <span className="absolute -top-0.5 end-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-caption font-semibold text-white" data-testid="notification-count"><bdi>{unread > 99 ? "99+" : unread}</bdi></span> : null}
      </button>
      {open ? (
        <div id={id} role="region" aria-label={t("title")} className="mz-card absolute end-0 top-11 z-40 w-[min(92vw,380px)] p-0 shadow-overlay" data-testid="notifications">
          <p className="border-b border-line px-4 py-3 text-label">{t("title")}</p>
          {q.data && q.data.data.length === 0 ? <p className="px-4 py-6 text-body-sm text-text-2">{t("empty")}</p> : null}
          <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
            {(q.data?.data ?? []).map((n) => {
              const href = hrefOf(n);
              const body = (
                <span className="flex flex-col gap-0.5">
                  <span className={n.read ? "text-text-2" : "font-medium"}><Bdi>{text(n)}</Bdi></span>
                  <span className="text-caption text-text-3"><DateText value={n.at} /></span>
                </span>
              );
              return (
                <li key={n.id} className="px-4 py-2.5 text-body-sm">
                  {href ? <Link href={href} className="block hover:underline" onClick={() => setOpen(false)}>{body}</Link> : body}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
