"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Button, ButtonGroup } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { TextArea } from "@/components/ui/Field";
import { useToast } from "@/components/ui/Toast";
import { ApiError, ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";

const PROBLEMS = new Set(["header", "columns", "tracking", "status", "date", "duplicate", "too_many", "empty", "unknown_tracking", "not_booked"]);

/**
 * The courier's status report as CSV (E7-6): a tracking number and a status per row (Arabic or
 * English), date and note optional. All or nothing: the lines that can't be applied are listed.
 */
export function StatusImport({ open, onClose }: { open: boolean; onClose(): void }) {
  const t = useTranslations("shipments.import");
  const { api } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [csv, setCsv] = useState("");
  const run = useMutation({
    mutationFn: () => ok(api.POST("/v1/shipments/statuses/import", { body: { csv } })),
    meta: { toast: false },
    onSuccess: (r) => {
      setCsv("");
      toast({ message: t("done", { changed: r.changed, unchanged: r.unchanged }) });
      void qc.invalidateQueries({ queryKey: ["shipments"] });
      void qc.invalidateQueries({ queryKey: ["scorecard"] });
      onClose();
    },
    onError: (e) => { if (!(e instanceof ApiError && e.code === "csv_invalid")) toast({ message: e instanceof ApiError && e.title ? e.title : t("failed") }); },
  });
  const lines = run.error instanceof ApiError && run.error.code === "csv_invalid" ? run.error.errors ?? [] : [];
  const readFile = async (file: File | undefined) => { if (file) { setCsv(await file.text()); run.reset(); } };
  return (
    <Dialog open={open} onClose={onClose} title={t("title")} description={t("body")}
      footer={(
        <ButtonGroup>
          <Button icon="upload" disabled={!csv.trim()} busy={run.isPending} onClick={() => run.mutate()}>{t("run")}</Button>
          <Button variant="ghost" onClick={onClose}>{t("close")}</Button>
        </ButtonGroup>
      )}>
      <div className="flex flex-col gap-3" data-testid="status-import">
        <label className="flex flex-col gap-1 text-label">
          {t("file")}
          <input type="file" accept=".csv,text/csv" className="text-body-sm" onChange={(e) => void readFile(e.target.files?.[0])} />
        </label>
        <TextArea label={t("paste")} hint={t("pasteHint")} rows={4} dir="auto" value={csv} onChange={(e) => { setCsv(e.target.value); run.reset(); }} />
        {lines.length ? (
          <Alert tone="danger" title={t("invalid", { count: lines.length })}>
            <ul className="mt-1 flex flex-col gap-0.5" data-testid="status-import-errors">
              {lines.slice(0, 10).map((p) => (
                <li key={`${p.path}-${p.code}`}>
                  {t.rich("line", { line: p.path.replace("line:", ""), n: (c) => <Bdi>{c}</Bdi> })}{" · "}{t(`problem.${PROBLEMS.has(p.code) ? p.code : "other"}`)}
                  {p.message ? <>{" · "}<bdi dir="auto">{p.message}</bdi></> : null}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}
