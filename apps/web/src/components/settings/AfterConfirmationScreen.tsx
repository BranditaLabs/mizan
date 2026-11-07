"use client";

import { AUTO_BOOK_CHANNELS, AUTO_BOOK_MODES, MEMBER_ROLES, rolesWith, Tag } from "@mizan/shared";
import { Icon } from "@mizan/design-system/icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { Bdi } from "@/components/Bdi";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Checkbox, Switch } from "@/components/ui/Choice";
import { Select } from "@/components/ui/Field";
import { SaveBar } from "@/components/ui/SaveBar";
import { Card, EmptyState, SkeletonRows } from "@/components/ui/Surface";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { Link } from "@/i18n/navigation";
import { ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";

type After = Schemas["AfterConfirmation"];
type Outcome = "confirmed" | "changed" | "cancelled" | "noAnswer" | "optedOut";
type Notify = After["confirmed"]["notify"];
type Role = Notify["roles"][number];
const OUTCOMES: readonly Outcome[] = ["confirmed", "changed", "cancelled", "noAnswer", "optedOut"];
const EDITORS = rolesWith("confirmation.manage");
// .mz-input is full width at the medium height: a number inside a sentence and the tag box are smaller.
const INLINE_NUM = { width: "4.5rem", height: "var(--mz-control-sm)", paddingInline: "6px" } as const;
const TAG_INPUT = { width: "16rem", maxWidth: "100%", height: "var(--mz-control-sm)" } as const;

/**
 * Settings → After confirmation (E6-23a/b): what happens after each outcome, read as sentences
 * ("When an order is confirmed → wait 30 minutes → tag it → book with Bosta"). Every action is off
 * until the store turns it on; the fixed rules (money, stock, the store's own order) are shown as
 * lines nobody can switch off. "Recommended" fills the draft only.
 */
export function AfterConfirmationScreen() {
  const t = useTranslations("afterConfirmation");
  const tpm = useTranslations("payments.mode");
  const locale = useLocale();
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const canEdit = EDITORS.has(store?.role ?? "");
  const key = ["afterConfirmation", user?.uid ?? "", store?.tenantId ?? ""];
  const query = useQuery({ queryKey: key, queryFn: () => ok(api.GET("/v1/settings/after-confirmation")), enabled: Boolean(store) && canEdit });
  const [draft, setDraft] = useState<After | null>(null);
  const [tab, setTab] = useState<Outcome>("confirmed");
  const save = useMutation({
    mutationFn: (body: After) => ok(api.PUT("/v1/settings/after-confirmation", { body })),
    onSuccess: (r) => { qc.setQueryData(key, r); setDraft(null); toast.event({ type: null, message: t("saved") }); },
  });

  const frame = (body: ReactNode) => (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-heading-lg">{t("title")}</h1>
          <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{t("subtitle")}</p>
        </div>
        {query.data && canEdit ? <Button variant="secondary" size="sm" icon="ai" onClick={() => setDraft(query.data.recommended)} data-testid="recommended">{t("recommended")}</Button> : null}
      </header>
      {body}
    </div>
  );
  if (!canEdit) return frame(<div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div>);
  if (query.isPending) return frame(<div className="mz-card"><SkeletonRows rows={6} label={t("loading")} /></div>);
  if (query.isError) return frame(<Alert tone="danger">{t("loadFailed")}</Alert>);

  const { couriers, members } = query.data;
  const s = draft ?? query.data.settings;
  const set = <K extends Outcome>(k: K, next: Partial<After[K]>) => setDraft({ ...s, [k]: { ...s[k], ...next } });
  const overlap = s.confirmed.tags.filter((x) => s.cancelled.tags.includes(x));
  const valid = overlap.length === 0;
  const overlapText = overlap.length ? <p className="mt-1 text-body-sm text-danger" role="alert">{t.rich("cancelled.overlap", { tags: () => <Bdi>{new Intl.ListFormat(locale, { type: "conjunction" }).format(overlap)}</Bdi> })}</p> : null;

  return frame(
    <>
      <Tabs label={t("tabs")} value={tab} onChange={setTab} items={OUTCOMES.map((o) => ({ value: o, label: t(`tab.${o}`) }))}>
        <Card>
          <p className="mb-4 text-label">{t(`when.${tab}`)}</p>
          <ol className="flex flex-col gap-4 border-s border-line-strong ps-4" data-testid={`after-${tab}`}>
            {tab === "confirmed" ? (
              <>
                <Row icon="pending">
                  <Sentence text={t.rich("confirmed.grace", { n: () => (
                    <Num value={s.confirmed.graceMinutes} min={0} max={120} label={t("confirmed.graceLabel")} onChange={(graceMinutes) => set("confirmed", { graceMinutes })}
                      className="mz-input mz-num mx-1.5 inline-block text-center" style={INLINE_NUM} />
                  ) })} />
                  <Hint>{t(s.confirmed.graceMinutes ? "confirmed.graceOn" : "confirmed.graceOff")}</Hint>
                </Row>
                <Row icon="tag"><Tags value={s.confirmed.tags} onChange={(tags) => set("confirmed", { tags })} sentence={t("confirmed.tags")} />{overlapText}</Row>
                <Row icon="message">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body-sm">{t("confirmed.message")}</span>
                    <Select label={t("confirmed.messageLabel")} value={s.confirmed.message} onChange={(e) => set("confirmed", { message: e.target.value as "short" | "summary" })} className="w-full max-w-72 [&>label]:sr-only">
                      <option value="short">{t("confirmed.messageShort")}</option>
                      <option value="summary">{t("confirmed.messageSummary")}</option>
                    </Select>
                  </div>
                </Row>
                <Row icon="shipping">
                  <Switch label={t("confirmed.autoBook")} description={t("confirmed.autoBookHint")} checked={s.confirmed.autoBook.enabled}
                    onChange={(e) => set("confirmed", { autoBook: { ...s.confirmed.autoBook, enabled: e.target.checked } })} />
                  {s.confirmed.autoBook.enabled ? (
                    <div className="mt-3 flex flex-col gap-3 rounded-md bg-surface-sunk p-3">
                      {couriers.length ? (
                        <Select label={t("confirmed.courier")} value={s.confirmed.autoBook.courierConnectionId ?? ""} className="w-full max-w-72"
                          onChange={(e) => set("confirmed", { autoBook: { ...s.confirmed.autoBook, courierConnectionId: e.target.value || null } })}>
                          <option value="">{t("confirmed.courierFirst")}</option>
                          {couriers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </Select>
                      ) : (
                        <Alert tone="warning">{t.rich("alert.noCourier", { link: (c) => <Link href="/settings/integrations" className="underline">{c}</Link> })}</Alert>
                      )}
                      <Choices legend={t("confirmed.modes")} options={AUTO_BOOK_MODES} labelOf={(m) => tpm(m as "cod")} value={s.confirmed.autoBook.paymentModes}
                        onChange={(paymentModes) => set("confirmed", { autoBook: { ...s.confirmed.autoBook, paymentModes: paymentModes as After["confirmed"]["autoBook"]["paymentModes"] } })} />
                      <Choices legend={t("confirmed.channels")} options={AUTO_BOOK_CHANNELS} labelOf={(c) => t(`channel.${c}`)} value={s.confirmed.autoBook.channels}
                        onChange={(channels) => set("confirmed", { autoBook: { ...s.confirmed.autoBook, channels: channels as After["confirmed"]["autoBook"]["channels"] } })} />
                      <Checkbox label={t("confirmed.afterChange")} checked={s.confirmed.autoBook.afterChange}
                        onChange={(e) => set("confirmed", { autoBook: { ...s.confirmed.autoBook, afterChange: e.target.checked } })} />
                    </div>
                  ) : null}
                </Row>
                <Row icon="notification"><NotifyRow t={t} value={s.confirmed.notify} onChange={(notify) => set("confirmed", { notify })} /></Row>
                <Fixed lines={[t("fixed.rule13"), t("fixed.cash"), t("fixed.customerWrites")]} />
              </>
            ) : null}

            {tab === "changed" ? (
              <>
                <Row icon="customer"><Fixed inline lines={[t("changed.fixed")]} /></Row>
                <Row icon="tag"><Tags value={s.changed.tags} onChange={(tags) => set("changed", { tags })} sentence={t("changed.tags")} /></Row>
                <Row icon="team">
                  <Select label={t("changed.assign")} value={s.changed.assignTo ?? ""} className="w-full max-w-72" onChange={(e) => set("changed", { assignTo: e.target.value || null })}>
                    <option value="">{t("changed.nobody")}</option>
                    {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </Select>
                </Row>
                <Row icon="notification"><NotifyRow t={t} value={s.changed.notify} onChange={(notify) => set("changed", { notify })} /></Row>
              </>
            ) : null}

            {tab === "cancelled" ? (
              <>
                <Row icon="tag">
                  <Tags value={s.cancelled.tags} onChange={(tags) => set("cancelled", { tags })} sentence={t("cancelled.tags")} />
                  {overlapText}
                </Row>
                <Row icon="notification"><NotifyRow t={t} value={s.cancelled.notify} onChange={(notify) => set("cancelled", { notify })} /></Row>
                <Fixed lines={[t("cancelled.fixedStore"), t("cancelled.fixedStock")]} />
              </>
            ) : null}

            {tab === "noAnswer" ? (
              <>
                <Row icon="call"><Fixed inline lines={[t("noAnswer.fixed")]} /></Row>
                <Row icon="tag"><Tags value={s.noAnswer.tags} onChange={(tags) => set("noAnswer", { tags })} sentence={t("noAnswer.tags")} /></Row>
                <Row icon="notification"><NotifyRow t={t} value={s.noAnswer.notify} onChange={(notify) => set("noAnswer", { notify })} /></Row>
                <Row icon="refused">
                  <Switch label={t("noAnswer.autoCancel")} description={t("noAnswer.autoCancelHint")} checked={s.noAnswer.autoCancel.enabled}
                    onChange={(e) => set("noAnswer", { autoCancel: { ...s.noAnswer.autoCancel, enabled: e.target.checked } })} />
                  {s.noAnswer.autoCancel.enabled ? (
                    <div className="mt-3 flex flex-col gap-3 rounded-md bg-surface-sunk p-3">
                      <div className="flex flex-wrap items-end gap-3">
                        <Select label={t("noAnswer.after")} value={s.noAnswer.autoCancel.after} className="w-full max-w-64"
                          onChange={(e) => set("noAnswer", { autoCancel: { ...s.noAnswer.autoCancel, after: e.target.value as "messages" | "team_calls" } })}>
                          <option value="messages">{t("noAnswer.afterMessages")}</option>
                          <option value="team_calls">{t("noAnswer.afterTeamCalls")}</option>
                        </Select>
                        <label className="flex flex-col gap-1.5 text-label">{t("noAnswer.hours")}
                          <Num value={s.noAnswer.autoCancel.afterHours} min={1} max={72} label={t("noAnswer.hours")} className="mz-input mz-num h-10 w-36"
                            onChange={(afterHours) => set("noAnswer", { autoCancel: { ...s.noAnswer.autoCancel, afterHours } })} />
                        </label>
                      </div>
                      <Checkbox label={t("noAnswer.ifAssigned")} checked={s.noAnswer.autoCancel.cancelIfAssigned}
                        onChange={(e) => set("noAnswer", { autoCancel: { ...s.noAnswer.autoCancel, cancelIfAssigned: e.target.checked } })} />
                    </div>
                  ) : null}
                </Row>
                <Fixed lines={[t("noAnswer.fixedPaid"), t("noAnswer.fixedWrites"), t("noAnswer.fixedStock")]} />
              </>
            ) : null}

            {tab === "optedOut" ? (
              <>
                <Row icon="call"><Fixed inline lines={[t("optedOut.fixed")]} /></Row>
                <Row icon="tag"><Tags value={s.optedOut.tags} onChange={(tags) => set("optedOut", { tags })} sentence={t("optedOut.tags")} /></Row>
                <Row icon="notification"><NotifyRow t={t} value={s.optedOut.notify} onChange={(notify) => set("optedOut", { notify })} /></Row>
              </>
            ) : null}
          </ol>
        </Card>
      </Tabs>
      <SaveBar dirty={draft !== null} busy={save.isPending} canSave={valid} onSave={() => save.mutate(s)} onDiscard={() => setDraft(null)} />
    </>,
  );
}

/** One step of the flow: an icon on the line, the sentence and its controls. */
function Row({ icon, children }: { icon: Parameters<typeof Icon>[0]["name"]; children: ReactNode }) {
  return (
    <li className="relative">
      <span aria-hidden="true" className="absolute -start-[calc(1rem+9px)] top-0.5 grid size-[18px] place-items-center rounded-full bg-surface text-text-2 ring-1 ring-line-strong">
        <Icon name={icon} size={12} />
      </span>
      {children}
    </li>
  );
}

function Sentence({ text }: { text: ReactNode }) {
  return <p className="text-body-sm leading-9">{text}</p>; // inline: the sentence flows around its control
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-caption text-text-3">{children}</p>;
}

/** What nobody can turn off, said plainly. */
function Fixed({ lines, inline = false }: { lines: string[]; inline?: boolean }) {
  const body = (
    <ul className="flex flex-col gap-1">
      {lines.map((l) => <li key={l} className="flex items-start gap-1.5 text-caption text-text-2"><Icon name="locked" size={12} className="mt-0.5 shrink-0" />{l}</li>)}
    </ul>
  );
  return inline ? body : <li className="list-none">{body}</li>;
}

/** Tags as chips: Enter or a comma adds one (the same rule as Automation Studio's tags). */
function Tags({ value, onChange, sentence }: { value: string[]; onChange(next: string[]): void; sentence: string }) {
  const t = useTranslations("afterConfirmation");
  const id = useId();
  const errId = `${id}-error`;
  const [text, setText] = useState("");
  const [error, setError] = useState(false);
  const add = () => {
    const v = text.trim().toLowerCase();
    if (!v) return;
    if (!Tag.safeParse(v).success || value.length >= 5) { setError(true); return; }
    if (!value.includes(v)) onChange([...value, v]);
    setText("");
    setError(false);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === "،") { e.preventDefault(); add(); }
    if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-body-sm">{sentence}</label>
      <div className="flex flex-wrap items-center gap-1.5">
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-surface-sunk px-2.5 py-0.5 text-caption">
            <Bdi>{tag}</Bdi>
            <button type="button" className="text-text-3 hover:text-text" aria-label={t("removeTag", { tag })} onClick={() => onChange(value.filter((x) => x !== tag))}><Icon name="close" size={12} /></button>
          </span>
        ))}
        <input id={id} aria-describedby={error ? errId : undefined} aria-invalid={error || undefined} className="mz-input" style={TAG_INPUT} value={text} placeholder={t("tagPlaceholder")} dir="auto"
          onChange={(e) => { setText(e.target.value); setError(false); }} onKeyDown={onKey} onBlur={add} />
      </div>
      {error ? <p id={errId} className="text-caption text-danger" role="alert">{t("tagInvalid")}</p> : null}
    </div>
  );
}

/** A notice for the team, and who gets it. */
function NotifyRow({ t, value, onChange }: { t: ReturnType<typeof useTranslations<"afterConfirmation">>; value: Notify; onChange(next: Notify): void }) {
  const tr = useTranslations("roles");
  return (
    <div className="flex flex-col gap-2">
      <Switch label={t("notify")} checked={value.enabled} onChange={(e) => onChange({ ...value, enabled: e.target.checked })} />
      {value.enabled ? (
        <Choices legend={t("notifyWho")} options={MEMBER_ROLES} labelOf={(r) => tr(r)} value={value.roles}
          onChange={(roles) => roles.length && onChange({ ...value, roles: roles as Role[] })} />
      ) : null}
    </div>
  );
}

function Choices({ legend, options, value, onChange, labelOf }: { legend: string; options: readonly string[]; value: readonly string[]; onChange(next: string[]): void; labelOf(v: string): string }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1 text-caption text-text-2">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {options.map((o) => (
          <Checkbox key={o} label={labelOf(o)} checked={value.includes(o)}
            onChange={(e) => onChange(e.target.checked ? [...value, o] : value.length > 1 ? value.filter((x) => x !== o) : [...value])} />
        ))}
      </div>
    </fieldset>
  );
}

/**
 * A whole number that keeps what is typed (an emptied field stays empty while typing) and settles
 * into its range when the field is left; the setting holds the last valid number meanwhile.
 */
function Num({ value, min, max, label, className, style, onChange }: { value: number; min: number; max: number; label: string; className?: string; style?: React.CSSProperties; onChange(next: number): void }) {
  const [text, setText] = useState<string | null>(null);
  const settle = (raw: string) => Math.max(min, Math.min(max, Math.round(Number(raw))));
  return (
    <input type="number" inputMode="numeric" dir="ltr" min={min} max={max} aria-label={label} className={className} style={style}
      value={text ?? String(value)}
      onChange={(e) => { setText(e.target.value); if (e.target.value !== "" && Number.isFinite(Number(e.target.value))) onChange(settle(e.target.value)); }}
      onBlur={() => { if (text !== null) { onChange(text === "" || !Number.isFinite(Number(text)) ? value : settle(text)); setText(null); } }} />
  );
}
