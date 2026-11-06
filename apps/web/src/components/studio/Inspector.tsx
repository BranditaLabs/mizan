"use client";

import { closestCenter, DndContext, PointerSensor, TouchSensor, useSensor, useSensors, type Announcements, type DragEndEvent, type Modifier } from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Icon } from "@mizan/design-system/icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Bdi } from "@/components/Bdi";
import { Button, IconButton } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { cx } from "@/components/ui/logic";
import type { Schemas } from "@/lib/api/client";
import { useKeyboardSort } from "./keyboard-sort";
import { forReason, forText, knownCode, type Lang, type StudioIssue } from "./issues";
import { estimateLength, insertAt, missingRequired, token } from "./length";
import { keysOf, type NodeId } from "./nodes";

export type Catalogue = Schemas["ScriptCatalogue"];
export type KeySpec = Catalogue["keys"][number];
export type Script = NonNullable<Schemas["ConfirmationSettings"]["script"]>;
export type Reason = NonNullable<Script["cancelReasons"]>[number];
type Texts = Record<string, string | undefined>;

/** Kinds typed on one line (WhatsApp shows them as titles or single lines). */
const ONE_LINE = new Set(["button", "list_button", "row", "section", "row_description", "fragment", "template_fragment", "header", "footer"]);
const vertical: Modifier = ({ transform }) => ({ ...transform, x: 0 });
export const fieldId = (key: string) => `studio-field-${key}`;
const MAX_TEXT = 5000;

/** An issue in words. */
export function useIssueText() {
  const t = useTranslations("confirmationStudio.issue");
  return (i: StudioIssue) => t(knownCode(i.code), { limit: i.limit ?? 0, length: i.length ?? 0, variable: i.variable ?? "" });
}

function Issues({ issues, id }: { issues: readonly StudioIssue[]; id?: string }) {
  const say = useIssueText();
  if (!issues.length) return null;
  return (
    <ul id={id} className="flex flex-col gap-1" role="alert">
      {issues.map((i, n) => <li key={n} className="mz-error-text"><Icon name="error" size={14} />{say(i)}</li>)}
    </ul>
  );
}

/**
 * The inspector (E6-16b): the node's texts in catalogue order, each with its variables as chips
 * (drag one into the text, or click to put it at the caret), a live counter like the API's and the
 * problems the preview or the save found; the cancel reasons; the team call.
 */
export function Inspector(p: {
  node: NodeId;
  catalogue: Catalogue;
  script: Script;
  lang: Lang;
  storeName: string | null;
  issues: readonly StudioIssue[];
  onText(key: string, value: string | null): void;
  onReasons(next: Reason[] | undefined): void;
  newReasonId(): string;
  onFocusKey(key: string | null): void;
  onClose(): void;
  team?: ReactNode;
}) {
  const t = useTranslations("confirmationStudio");
  const keys = keysOf(p.catalogue.keys, p.node);
  return (
    <section className="mz-card flex flex-col gap-5 p-4 sm:p-5" aria-labelledby="studio-inspector-title" data-testid="studio-inspector">
      <header className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 id="studio-inspector-title" className="text-heading-sm">{t(`nodes.${p.node}.title`)}</h2>
          <p className="text-body-sm text-text-2">{t(`nodes.${p.node}.body`)}</p>
        </div>
        <IconButton icon="close" label={t("inspector.close")} size="sm" onClick={p.onClose} />
      </header>
      {p.team}
      {keys.map((k) => (
        <KeyField key={`${p.lang}-${k.key}`} spec={k} catalogue={p.catalogue} script={p.script} lang={p.lang} storeName={p.storeName}
          issues={forText(p.issues, p.lang, k.key)} onChange={(v) => p.onText(k.key, v)} onFocus={() => p.onFocusKey(k.key)} />
      ))}
      {p.node === "cancel" ? <ReasonsEditor {...p} /> : null}
    </section>
  );
}

function KeyField({ spec, catalogue, script, lang, storeName, issues, onChange, onFocus }: {
  spec: KeySpec; catalogue: Catalogue; script: Script; lang: Lang; storeName: string | null; issues: readonly StudioIssue[]; onChange(v: string | null): void; onFocus(): void;
}) {
  const t = useTranslations("confirmationStudio");
  const tv = useTranslations("confirmationStudio.vars");
  const locale = useLocale();
  const ref = useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  // Where the caret goes after a chip is put in: applied as the new text is committed, before the next key.
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const e = ref.current;
    if (caret.current === null || !e) return;
    e.focus();
    e.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });
  const value = (script.texts[lang] as Texts)[spec.key] ?? "";
  const pack = catalogue.packTexts[script.pack]?.[lang]?.[spec.key] ?? "";
  const placeholder = pack || (spec.composed ? t("inspector.composed") : spec.optional ? t("inspector.optional") : "");
  const widths = new Map(catalogue.variables.map((v) => [v.name as string, v.width]));
  const counted = value || pack;
  const length = counted ? estimateLength(counted, widths, storeName) : 0;
  const over = length > spec.limit;
  const missing = value ? missingRequired(value, spec.required) : [];
  const id = fieldId(spec.key);
  const note = `${id}-note`;
  const oneLine = ONE_LINE.has(spec.kind);
  const titles = ["button", "list_button", "row", "section"].includes(spec.kind);

  const set = (v: string) => onChange(v.trim() ? v : null);
  const insert = (name: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? start;
    const next = insertAt(value, token(name), start, end);
    caret.current = next.caret;
    set(next.value);
  };
  const common = {
    id, ref, dir: lang === "ar" ? "rtl" : "ltr", lang, value, placeholder, maxLength: MAX_TEXT,
    "aria-invalid": issues.length || over || missing.length ? true : undefined, "aria-describedby": note,
    onFocus, onChange: (e: { target: { value: string } }) => set(e.target.value),
  } as const;

  return (
    <div className="mz-field" data-testid={`key-${spec.key}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <label htmlFor={id} className="mz-label">{t(`keys.${spec.key}.label`)}</label>
        <span className={cx("text-caption mz-num", over ? "font-medium text-danger" : "text-text-3")} aria-live="polite" data-testid="counter">
          <bdi>{t("inspector.counter", { n: length, limit: spec.limit })}</bdi>
        </span>
      </div>
      {oneLine
        ? <input {...common} type="text" className="mz-input" />
        : <textarea {...common} rows={spec.kind === "composed" ? 6 : 3} className="mz-textarea" />}
      <div id={note} className="flex flex-col gap-1.5">
        <p className="mz-hint">{t(`keys.${spec.key}.hint`)}</p>
        {spec.vars.length && !titles ? (
          <div className="flex flex-col gap-1">
            <span className="text-caption text-text-3">{t("inspector.vars")}</span>
            <ul className="flex flex-wrap gap-1.5" aria-label={t("inspector.vars")}>
              {spec.vars.map((v) => (
                <li key={v}>
                  <button type="button" draggable data-testid={`var-${v}`}
                    onDragStart={(e) => { e.dataTransfer.setData("text/plain", token(v)); e.dataTransfer.effectAllowed = "copy"; }}
                    onClick={() => insert(v)} aria-label={t("inspector.insert", { name: tv(v) })}
                    className="inline-flex cursor-grab items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-caption hover:bg-surface-hover">
                    <Icon name="add" size={12} className="text-text-3" />
                    <span>{tv(v)}</span>
                    <bdi dir="ltr" className="font-mono text-text-3">{token(v)}</bdi>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {missing.length ? <p className="mz-error-text" role="alert"><Icon name="warning" size={14} />{t("inspector.missing", { names: new Intl.ListFormat(locale).format(missing.map((m) => tv(m))) })}</p> : null}
        {over && !issues.some((i) => i.code === "too_long") ? <p className="mz-error-text" role="alert"><Icon name="error" size={14} />{t("issue.too_long", { length, limit: spec.limit })}</p> : null}
        <Issues issues={issues} />
        {value ? (
          <div><Button size="sm" variant="ghost" icon="refresh" onClick={() => onChange(null)}>{t("inspector.usePack")}</Button></div>
        ) : null}
      </div>
    </div>
  );
}

/** Reason titles and descriptions as WhatsApp allows them (the API checks the same). */
const TITLE_MAX = 24;
const DESC_MAX = 72;

function ReasonsEditor(p: { catalogue: Catalogue; script: Script; lang: Lang; issues: readonly StudioIssue[]; onReasons(next: Reason[] | undefined): void; newReasonId(): string }) {
  const t = useTranslations("confirmationStudio.reasons");
  const tc = useTranslations("confirmationStudio.codes");
  const own = p.script.cancelReasons;
  const packReasons = p.catalogue.packReasons[p.script.pack] ?? [];
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  );
  const listIssues = p.issues.filter((i) => i.target.area === "reasons");

  const titleOf = (r: Reason, i: number) => r.title[p.lang] || t("untitled", { n: i + 1 });
  const keys = useKeyboardSort<Reason>({
    items: own ?? [], idOf: (r) => r.id, onChange: (next) => p.onReasons(next),
    move: (items, from, by) => (from + by < 0 || from + by >= items.length ? [...items] : arrayMove([...items], from, from + by)),
    say: {
      picked: (r, i) => t("dnd.picked", { item: titleOf(r, i) }),
      moved: (r, i) => t("dnd.over", { item: titleOf(r, i), n: i + 1 }),
      dropped: (r, i) => t("dnd.dropped", { item: titleOf(r, i), n: i + 1 }),
      cancelled: (r) => t("dnd.cancelled", { item: titleOf(r, 0) }),
    },
  });

  if (!own) {
    return (
      <section className="flex flex-col gap-3 border-t border-line pt-4" aria-labelledby="reasons-title" data-testid="reasons">
        <ReasonsHead />
        <ul className="flex flex-col gap-1.5">
          {packReasons.map((r) => (
            <li key={r.id} className="flex flex-col rounded-md bg-surface-sunk px-3 py-2" dir={p.lang === "ar" ? "rtl" : "ltr"}>
              <span className="text-body-sm">{r.title[p.lang] ?? r.title.ar ?? r.title.en}</span>
              {r.description?.[p.lang] ? <span className="text-caption text-text-3">{r.description[p.lang]}</span> : null}
            </li>
          ))}
        </ul>
        <div><Button size="sm" variant="secondary" icon="edit" onClick={() => p.onReasons(packReasons.map((r) => ({ ...r, title: { ...r.title }, ...(r.description ? { description: { ...r.description } } : {}) })))}>{t("customise")}</Button></div>
      </section>
    );
  }

  const set = (i: number, next: Partial<Reason>) => p.onReasons(own.map((r, j) => (j === i ? { ...r, ...next } : r)));
  const name = (i: number) => own[i]?.title[p.lang] || t("untitled", { n: i + 1 });
  const at = (id: unknown) => own.findIndex((r) => r.id === String(id));
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("dnd.picked", { item: name(at(active.id)) }),
    onDragOver: ({ active, over }) => t("dnd.over", { item: name(at(active.id)), n: Math.max(1, at(over?.id) + 1) }),
    onDragEnd: ({ active, over }) => t("dnd.dropped", { item: name(at(active.id)), n: Math.max(1, at(over?.id) + 1) }),
    onDragCancel: ({ active }) => t("dnd.cancelled", { item: name(at(active.id)) }),
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || over.id === active.id) return;
    const from = at(active.id);
    const to = at(over.id);
    if (from >= 0 && to >= 0) p.onReasons(arrayMove(own, from, to));
  };
  return (
    <section className="flex flex-col gap-3 border-t border-line pt-4" aria-labelledby="reasons-title" data-testid="reasons">
      <ReasonsHead />
      <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[vertical]} onDragEnd={onDragEnd}
        accessibility={{ announcements, screenReaderInstructions: { draggable: t("dnd.instructions") } }}>
        <SortableContext items={own.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <ol className="flex flex-col gap-2">
            {own.map((r, i) => (
              <ReasonRow key={r.id} reason={r} index={i} count={own.length} lang={p.lang} codes={p.catalogue.cancelCodes} codeLabel={(c) => tc(c)}
                issues={forReason(p.issues, i, p.lang)} onChange={(next) => set(i, next)} onRemove={() => p.onReasons(own.filter((_, j) => j !== i))}
                onMove={(to) => p.onReasons(arrayMove(own, i, to))} keyboard={keys.handleProps(r.id)} />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <p className="sr-only" aria-live="assertive" aria-atomic="true">{keys.announcement}</p>
      <Issues issues={listIssues} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" icon="add" disabled={own.length >= p.catalogue.maxReasons}
          onClick={() => p.onReasons([...own, { id: p.newReasonId(), code: "other", title: { [p.lang]: "" } }])}>{t("add")}</Button>
        <Button size="sm" variant="ghost" icon="refresh" onClick={() => p.onReasons(undefined)}>{t("usePack")}</Button>
      </div>
      {own.length >= p.catalogue.maxReasons ? <p className="text-caption text-text-3">{t("max", { n: p.catalogue.maxReasons })}</p> : null}
    </section>
  );
}

function ReasonsHead() {
  const t = useTranslations("confirmationStudio.reasons");
  return (
    <div className="flex flex-col gap-0.5">
      <h3 id="reasons-title" className="text-label">{t("title")}</h3>
      <p className="text-body-sm text-text-2">{t("body")}</p>
    </div>
  );
}

function ReasonRow({ reason, index, count, lang, codes, codeLabel, issues, onChange, onRemove, onMove, keyboard }: {
  keyboard: ReturnType<ReturnType<typeof useKeyboardSort<Reason>>["handleProps"]>;
  reason: Reason; index: number; count: number; lang: Lang; codes: readonly Reason["code"][]; codeLabel(c: Reason["code"]): string;
  issues: readonly StudioIssue[]; onChange(next: Partial<Reason>): void; onRemove(): void; onMove(to: number): void;
}) {
  const t = useTranslations("confirmationStudio.reasons");
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: reason.id });
  const dir = lang === "ar" ? "rtl" : "ltr";
  const title = reason.title[lang] ?? "";
  const desc = reason.description?.[lang] ?? "";
  const n = index + 1;
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cx("flex flex-col gap-2 rounded-md border border-line bg-surface p-3", isDragging && "relative z-10 shadow-overlay")} data-testid="reason-row">
      <div className="flex flex-wrap items-end gap-2">
        <button type="button" {...attributes} {...listeners} {...keyboard} ref={(el) => { setActivatorNodeRef(el); keyboard.ref(el); }} aria-label={t("handle", { n })}
          className="mb-1 grid size-8 cursor-grab touch-none place-items-center rounded-md text-text-3 hover:bg-surface-hover hover:text-text">
          <svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor" aria-hidden="true">
            {[3, 9, 15].flatMap((y) => [4, 10].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />))}
          </svg>
        </button>
        <Field label={t("titleLabel", { n })} hint={<Bdi>{t("chars", { n: title.length, max: TITLE_MAX })}</Bdi>} dir={dir} lang={lang} maxLength={TITLE_MAX} value={title}
          className="min-w-40 flex-1"
          onChange={(e) => onChange({ title: { ...reason.title, [lang]: e.target.value } })} />
        <div className="mz-field" style={{ inlineSize: "11rem" }}>
          <label htmlFor={`${reason.id}-code`} className="mz-label">{t("code")}</label>
          <select id={`${reason.id}-code`} className="mz-select" value={reason.code} onChange={(e) => onChange({ code: e.target.value as Reason["code"] })}>
            {codes.map((c) => <option key={c} value={c}>{codeLabel(c)}</option>)}
          </select>
        </div>
        <span className="mb-1 flex items-center">
          <IconButton icon="arrow-up" size="sm" label={t("moveUp", { n })} disabled={index === 0} onClick={() => onMove(index - 1)} />
          <IconButton icon="arrow-down" size="sm" label={t("moveDown", { n })} disabled={index === count - 1} onClick={() => onMove(index + 1)} />
          <IconButton icon="delete" size="sm" label={t("remove", { n })} disabled={count <= 1} onClick={onRemove} />
        </span>
      </div>
      <Field label={t("descLabel")} hint={<Bdi>{t("chars", { n: desc.length, max: DESC_MAX })}</Bdi>} dir={dir} lang={lang} maxLength={DESC_MAX} value={desc}
        onChange={(e) => onChange({ description: { ...reason.description, [lang]: e.target.value } })} />
      <Issues issues={issues} />
    </li>
  );
}
