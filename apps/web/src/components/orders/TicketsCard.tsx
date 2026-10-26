"use client";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { NewTicketDialog } from "@/components/tickets/NewTicketDialog";
import { CREATE_ROLES, STATUS_TONE } from "@/components/tickets/ticket-ui";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { IdCell } from "@/components/ui/DataTable";
import { Card } from "@/components/ui/Surface";
import { Link, useRouter } from "@/i18n/navigation";
import { ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";

/** The order's tickets (E10-1), and a button to open one on it. */
export function TicketsCard({ order }: { order: { id: string; number: string } }) {
  const t = useTranslations("tickets");
  const { api, user, store } = useSession();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["tickets", user?.uid ?? "", store?.tenantId ?? "", "order", order.id],
    queryFn: () => ok(api.GET("/v1/tickets", { params: { query: { orderId: order.id, view: "all", limit: 20 } } })),
    enabled: Boolean(store),
    meta: { toast: false },
  });
  const canCreate = CREATE_ROLES.has(store?.role ?? "");
  return (
    <Card title={t("title")} actions={canCreate ? <Button size="sm" variant="secondary" icon="add" onClick={() => setOpen(true)}>{t("openOne")}</Button> : null}>
      <div data-testid="order-tickets">
        {q.data && q.data.data.length === 0 ? <p className="text-body-sm text-text-2">{t("noneForOrder")}</p> : null}
        <ul className="flex flex-col divide-y divide-line">
          {(q.data?.data ?? []).map((tk) => (
            <li key={tk.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="flex items-center gap-2">
                <Link href={`/tickets/${tk.id}`} className="hover:underline"><IdCell>{tk.number}</IdCell></Link>
                <span className="text-body-sm">{t(`type.${tk.type}`)}</span>
              </span>
              <Badge tone={STATUS_TONE[tk.status]}>{t(`status.${tk.status}`)}</Badge>
            </li>
          ))}
        </ul>
      </div>
      {open ? <NewTicketDialog order={order} onClose={() => setOpen(false)} onCreated={(tk) => router.push(`/tickets/${tk.id}`)} /> : null}
    </Card>
  );
}
