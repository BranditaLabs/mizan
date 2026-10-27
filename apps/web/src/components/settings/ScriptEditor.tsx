"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Select, TextArea } from "@/components/ui/Field";
import { Card } from "@/components/ui/Surface";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";

type Script = NonNullable<Schemas["ConfirmationSettings"]["script"]>;
type Key = keyof Script["texts"]["ar"];
type Lang = "ar" | "en";
const GROUPS: ReadonlyArray<{ branch: "confirm" | "change" | "cancel" | "call"; keys: readonly Key[] }> = [
  { branch: "confirm", keys: ["confirmed"] },
  { branch: "change", keys: ["change_prompt", "change_received"] },
  { branch: "cancel", keys: ["cancel_prompt", "cancelled"] },
  { branch: "call", keys: ["call"] },
];
/** As typed in a message: {{order.number}}. */
const TOKENS = ["customer.first_name", "order.number", "order.total", "order.cod", "order.items", "order.city", "store.name"].map((v) => `{{${v}}}`);
export const DEFAULT_SCRIPT: Script = { pack: "egyptian", texts: { ar: {}, en: {} } };

/**
 * The store's confirmation script (M2, E6-5): its own words for what the customer reads after each
 * button and for the team's call, with variables from the order; empty boxes keep the language
 * pack's wording (Egyptian, or formal Arabic). "Preview" fills it from a sample order.
 */
export function ScriptEditor({ value, onChange }: { value: Script | undefined; onChange(next: Script): void }) {
  const t = useTranslations("confirmationSettings.script");
  const { api } = useSession();
  const script = value ?? DEFAULT_SCRIPT;
  const [lang, setLang] = useState<Lang>("ar");
  const preview = useMutation({
    mutationFn: () => ok(api.POST("/v1/settings/confirmation/preview", { body: { script } })),
  });
  const setText = (key: Key, text: string) => {
    const texts = { ...script.texts[lang] };
    if (text.trim()) texts[key] = text; else delete texts[key];
    onChange({ ...script, texts: { ...script.texts, [lang]: texts } });
    preview.reset();
  };
  return (
    <Card title={t("title")}>
      <div className="flex flex-col gap-4" data-testid="script-editor">
        <p className="text-body-sm text-text-2">{t("body")}</p>
        <div className="flex flex-wrap items-end gap-3">
          <Select label={t("pack")} value={script.pack} onChange={(e) => { onChange({ ...script, pack: e.target.value as Script["pack"] }); preview.reset(); }} className="w-56">
            <option value="egyptian">{t("packs.egyptian")}</option>
            <option value="formal">{t("packs.formal")}</option>
          </Select>
          <nav aria-label={t("language")} className="mz-tabs">
            {(["ar", "en"] as const).map((l) => <button key={l} type="button" className="mz-tab" aria-current={lang === l ? "true" : undefined} onClick={() => setLang(l)}>{t(`lang.${l}`)}</button>)}
          </nav>
        </div>
        <p className="text-caption text-text-3">
          {t("variables")}{" "}
          {TOKENS.map((v) => <code key={v} dir="ltr" className="me-1.5 inline-block rounded-xs bg-surface-sunk px-1">{v}</code>)}
        </p>
        {GROUPS.map((g) => (
          <fieldset key={g.branch} className="flex flex-col gap-3">
            <legend className="mb-1 text-label">{t(`branch.${g.branch}`)}</legend>
            {g.keys.map((k) => (
              <TextArea key={`${lang}-${k}`} label={t(`keys.${k}`)} hint={t("keepPack")} rows={k === "call" ? 5 : 2} dir={lang === "ar" ? "rtl" : "ltr"}
                maxLength={k === "call" ? 2000 : 1000} value={script.texts[lang][k] ?? ""} onChange={(e) => setText(k, e.target.value)} />
            ))}
          </fieldset>
        ))}
        <div>
          <Button variant="secondary" busy={preview.isPending} onClick={() => preview.mutate()}>{t("preview")}</Button>
        </div>
        {preview.data ? (
          <section className="flex flex-col gap-3 rounded-md border border-line p-4" aria-label={t("previewTitle")} data-testid="script-preview">
            <h3 className="text-label">{t("previewTitle")}</h3>
            <ul className="flex flex-col gap-2">
              {preview.data.replies.map((r) => (
                <li key={r.key} className="flex flex-col gap-0.5">
                  <span className="text-caption text-text-3">{t(`branch.${r.branch}`)}{" · "}{t(`keys.${r.key}`)}</span>
                  <p dir="auto" className="whitespace-pre-line rounded-md bg-surface-sunk p-2 text-body-sm">{r.text}</p>
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-0.5">
              <span className="text-caption text-text-3">{t("branch.call")}</span>
              <ol className="list-decimal ps-5 text-body-sm">{preview.data.call.map((l, i) => <li key={i} dir="auto">{l}</li>)}</ol>
            </div>
          </section>
        ) : null}
      </div>
    </Card>
  );
}
