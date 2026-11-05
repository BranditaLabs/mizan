"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { ok } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";

/**
 * Cancel a booked delivery at Bosta (terminate). Asked once; the shipment shows cancelled when Bosta
 * confirms. Bosta refuses a parcel already picked up: the shipment then waits in review with why.
 */
export function CancelAtCourier({ shipmentId }: { shipmentId: string }) {
  const t = useTranslations("shipping.cancelAtCourier");
  const tpr = useTranslations("problems");
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const cancel = useMutation({
    mutationFn: () => ok(api.POST("/v1/shipments/{id}/cancel", { params: { path: { id: shipmentId } } })),
    meta: { toast: false },
    onSuccess: (r) => {
      toast({ message: r.queued ? t("queued") : t("already") });
      void qc.invalidateQueries({ queryKey: ["order"] });
      void qc.invalidateQueries({ queryKey: ["shipments"] });
      setOpen(false);
    },
  });
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>{t("open")}</Button>
      {open ? (
        <Dialog open onClose={() => setOpen(false)} title={t("title")} description={t("body")} footer={(
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>{t("back")}</Button>
            <Button variant="danger" busy={cancel.isPending} onClick={() => cancel.mutate()}>{t("confirm")}</Button>
          </>
        )}>
          {cancel.isError ? <Alert tone="danger">{problemText(cancel.error, tpr)}</Alert> : null}
        </Dialog>
      ) : null}
    </>
  );
}
