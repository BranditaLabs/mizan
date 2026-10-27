"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { Bdi } from "@/components/Bdi";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, Select, TextArea } from "@/components/ui/Field";
import { When } from "@/components/ui/When";
import { ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";

const TONE: Record<string, BadgeTone> = { info: "info", warning: "warning", critical: "danger" };
const empty = { level: "info" as "info" | "warning" | "critical", titleAr: "", titleEn: "", bodyAr: "", bodyEn: "", link: "", hours: "24", countries: "" };

/** A-6: announcements across the merchants' dashboard, in Arabic and English, for a window. */
export function AnnouncementsScreen() {
  const t = useTranslations("announcements");
  const qc = useQueryClient();
  const { api, can } = useSession();
  const editable = can("super_admin", "support");
  const q = useQuery({ queryKey: ["announcements"], queryFn: () => ok(api.GET("/v1/platform/announcements")) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["announcements"] });
  const [d, setD] = useState(empty);
  const create = useMutation({
    mutationFn: () => {
      const countries = d.countries.split(/[\s,]+/).map((c) => c.trim().toUpperCase()).filter(Boolean);
      return ok(api.POST("/v1/platform/announcements", { body: {
        level: d.level, titleAr: d.titleAr.trim(), titleEn: d.titleEn.trim(), bodyAr: d.bodyAr.trim(), bodyEn: d.bodyEn.trim(),
        ...(d.link.trim() ? { link: d.link.trim() } : {}), ...(countries.length ? { countries } : {}),
        endsAt: new Date(Date.now() + Number(d.hours) * 3_600_000).toISOString(),
      } }));
    },
    onSuccess: () => { setD(empty); void refresh(); },
  });
  const end = useMutation({ mutationFn: (id: string) => ok(api.POST("/v1/platform/announcements/{id}/end", { params: { path: { id } } })), onSettled: refresh });
  const onSubmit = (e: FormEvent) => { e.preventDefault(); if (d.titleAr.trim() && d.titleEn.trim()) create.mutate(); };
  // Compared with when the list was loaded (not "now" during render): an ended one loses its button on the next load.
  const live = (endsAt: string) => Date.parse(endsAt) > q.dataUpdatedAt;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="text-body-sm text-text-2">{t("subtitle")}</p>
      </header>
      {editable ? (
        <form onSubmit={onSubmit} className="grid gap-3 rounded-lg border border-line bg-surface p-4 md:grid-cols-2" noValidate>
          <Field label={t("titleAr")} dir="rtl" lang="ar" value={d.titleAr} maxLength={120} name="titleAr" onChange={(e) => setD({ ...d, titleAr: e.target.value })} />
          <Field label={t("titleEn")} dir="ltr" lang="en" value={d.titleEn} maxLength={120} name="titleEn" onChange={(e) => setD({ ...d, titleEn: e.target.value })} />
          <TextArea label={t("bodyAr")} dir="rtl" lang="ar" rows={2} value={d.bodyAr} maxLength={1000} name="bodyAr" onChange={(e) => setD({ ...d, bodyAr: e.target.value })} />
          <TextArea label={t("bodyEn")} dir="ltr" lang="en" rows={2} value={d.bodyEn} maxLength={1000} name="bodyEn" onChange={(e) => setD({ ...d, bodyEn: e.target.value })} />
          <Select label={t("level")} value={d.level} onChange={(e) => setD({ ...d, level: e.target.value as "info" })}>
            {(["info", "warning", "critical"] as const).map((l) => <option key={l} value={l}>{t(`levels.${l}`)}</option>)}
          </Select>
          <Select label={t("duration")} value={d.hours} onChange={(e) => setD({ ...d, hours: e.target.value })}>
            {["1", "6", "24", "72", "168"].map((h) => <option key={h} value={h}>{t("hours", { n: Number(h) })}</option>)}
          </Select>
          <Field label={t("link")} ltr placeholder="https://" value={d.link} name="link" onChange={(e) => setD({ ...d, link: e.target.value })} />
          <Field label={t("countries")} hint={t("countriesHint")} ltr value={d.countries} name="countries" onChange={(e) => setD({ ...d, countries: e.target.value })} />
          <div className="md:col-span-2"><Button type="submit" busy={create.isPending} disabled={!d.titleAr.trim() || !d.titleEn.trim()}>{t("post")}</Button></div>
        </form>
      ) : null}
      <ul className="flex flex-col gap-3" data-testid="announcements-list">
        {(q.data?.data ?? []).map((a) => (
          <li key={a.id} className="rounded-lg border border-line bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium" lang="ar" dir="rtl">{a.titleAr}</p>
                <p className="font-medium" lang="en" dir="ltr">{a.titleEn}</p>
                <p className="text-caption text-text-2"><When value={a.startsAt} time /> — <When value={a.endsAt} time />{a.countries ? <> · <Bdi>{a.countries.join(", ")}</Bdi></> : null}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={TONE[a.level] ?? "neutral"}>{t(`levels.${a.level}`)}</Badge>
                {editable && live(a.endsAt) ? <Button size="sm" variant="secondary" onClick={() => end.mutate(a.id)}>{t("end")}</Button> : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
