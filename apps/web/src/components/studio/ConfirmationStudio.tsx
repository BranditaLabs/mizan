"use client";

import { rolesWith } from "@mizan/shared";
import { Icon } from "@mizan/design-system/icons/react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Choice";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { SaveBar } from "@/components/ui/SaveBar";
import { EmptyState, Skeleton, SkeletonRows } from "@/components/ui/Surface";
import { useToast } from "@/components/ui/Toast";
import { cx } from "@/components/ui/logic";
import { Link } from "@/i18n/navigation";
import { ApiError, ok, type Schemas } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { idMaker, stepsValid, withIds, withoutIds, type Channel, type FlowStep } from "./flow";
import { fieldId, Inspector, type Catalogue, type Reason, type Script } from "./Inspector";
import { mergeIssues, refusedTexts, toIssues, type Lang, type StudioIssue, type TextsByLang } from "./issues";
import { scrollBehavior } from "./motion";
import { BRANCHES, keysOf, nodeOf, SCENARIO_OF, type NodeId } from "./nodes";
import { keep, reveal, START, type SimState } from "./simulation";
import { StudioFlow, type BranchView } from "./StudioFlow";
import { StudioPhone } from "./StudioPhone";
import type { PhoneChrome } from "./WhatsAppPhone";

type Settings = Schemas["ConfirmationSettings"];
interface Draft { settings: Settings; steps: FlowStep[] }
const EDITORS = rolesWith("confirmation.manage");
const PACKS = ["egyptian", "formal", "gulf"] as const;
const DEFAULT_SCRIPT: Script = { pack: "egyptian", texts: { ar: {}, en: {} } };
const DEBOUNCE_MS = 350;
const WIDE = "(min-width: 1280px)";

/** Whether the screen is wide enough for the phone beside the flow (no sheet). */
function useWide(): boolean {
  return useSyncExternalStore(
    (on) => { const q = window.matchMedia(WIDE); q.addEventListener("change", on); return () => q.removeEventListener("change", on); },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

/** What the API reads: no empty texts, no empty reason titles or descriptions. */
export function cleanScript(s: Script): Script {
  const texts = (l: Lang) => Object.fromEntries(Object.entries(s.texts[l] ?? {}).filter(([, v]) => typeof v === "string" && v.trim())) as Script["texts"][Lang];
  const filled = (o: Record<string, string | undefined> | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v?.trim()));
  const reasons = s.cancelReasons?.map((r): Reason => {
    const description = filled(r.description);
    return { id: r.id, code: r.code, title: filled(r.title), ...(Object.keys(description).length ? { description } : {}) };
  });
  return { ...(s.version ? { version: s.version } : {}), pack: s.pack, texts: { ar: texts("ar"), en: texts("en") }, ...(reasons ? { cancelReasons: reasons } : {}) };
}

/**
 * Settings → Confirmation → Studio (M2, E6-16b): the buyer's WhatsApp confirmation as a flow anyone
 * can build. The cascade of steps (drag and drop), what the buyer can do in the chat and every word
 * they read, and the team's call, with the result on a WhatsApp phone that plays the chat live.
 */
export function ConfirmationStudio({ chrome }: { chrome: Record<Lang, PhoneChrome> }) {
  const t = useTranslations("confirmationStudio");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const wide = useWide();
  const canEdit = EDITORS.has(store?.role ?? "");
  const uid = user?.uid ?? "";
  const tenant = store?.tenantId ?? "";
  const settingsKey = ["confirmationSettings", uid, tenant];
  const query = useQuery({ queryKey: settingsKey, queryFn: () => ok(api.GET("/v1/settings/confirmation")), enabled: Boolean(store) && canEdit });
  const catalogue = useQuery({ queryKey: ["scriptCatalogue", uid, tenant], queryFn: () => ok(api.GET("/v1/settings/confirmation/script-catalogue")), enabled: Boolean(store) && canEdit, staleTime: Infinity });
  const after = useQuery({ queryKey: ["afterConfirmation", uid, tenant], queryFn: () => ok(api.GET("/v1/settings/after-confirmation")), enabled: Boolean(store) && canEdit, meta: { toast: false } });

  // Step ids for the sortable list: one counter per screen, never reused.
  const [nextStepId] = useState(() => idMaker("s"));
  const serverDraft = useMemo<Draft | null>(() => (query.data ? { settings: query.data.settings, steps: withIds(query.data.settings.steps, nextStepId) } : null), [query.data, nextStepId]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const cur = draft ?? serverDraft;
  const script = cur?.settings.script ?? DEFAULT_SCRIPT;
  const reasonIds = useRef<(() => string) | null>(null);
  const newReasonId = () => {
    reasonIds.current ??= idMaker("r", [...(script.cancelReasons ?? []), ...(catalogue.data?.packReasons[script.pack] ?? [])].map((r) => r.id));
    return reasonIds.current();
  };

  const [lang, setLang] = useState<Lang>(() => (store?.locale?.startsWith("en") ? "en" : "ar"));
  const [selected, setSelected] = useState<NodeId | null>("confirms");
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [saveIssues, setSaveIssues] = useState<StudioIssue[]>([]);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [restoring, setRestoring] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [sim, setSim] = useState<SimState>(START);
  const [offer, setOffer] = useState(false);
  const pendingFocus = useRef<string | null>(null);
  // The flow's button that opened the inspector: focus goes back to it when the inspector closes.
  const opener = useRef<HTMLElement | null>(null);

  // The phone follows the draft, ~350 ms after the last edit; the old chat stays while the new one loads.
  const body = useMemo(() => JSON.stringify({ script: cleanScript(script), lang }), [script, lang]);
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setDebounced(body), debounced ? DEBOUNCE_MS : 0);
    return () => clearTimeout(h);
  }, [body, debounced]);
  const preview = useQuery({
    queryKey: ["confirmationPreview", uid, tenant, debounced],
    queryFn: () => ok(api.POST("/v1/settings/confirmation/preview", { body: JSON.parse(debounced) as Schemas["ScriptPreviewRequest"] })),
    enabled: Boolean(serverDraft) && Boolean(debounced), placeholderData: keepPreviousData, staleTime: 60_000, meta: { toast: false },
  });

  const save = useMutation({
    mutationFn: (b: Settings) => ok(api.PUT("/v1/settings/confirmation", { body: b })),
    meta: { toast: false },
    onSuccess: (r) => { qc.setQueryData(settingsKey, r); setDraft(null); setSaveIssues([]); setSaveError(null); toast({ message: t("saved") }); },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 422 && e.errors?.length) {
        const found = toIssues(e.errors, false);
        setSaveIssues(found);
        setSaveError(null);
        goTo(found[0]!);
      } else setSaveError(e);
    },
  });

  // Focus the field a bubble or an issue pointed at, once the inspector shows it.
  useEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    const el = document.getElementById(fieldId(key));
    if (!el) return;
    pendingFocus.current = null;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: "center", behavior: scrollBehavior() });
  });

  const frame = (content: React.ReactNode) => (
    <div className="flex min-w-0 flex-col gap-5" data-testid="confirmation-studio">
      <header className="flex flex-col gap-1">
        <Link href="/settings/confirmation" className="inline-flex w-fit items-center gap-1.5 text-body-sm text-text-2 hover:text-text">
          <Icon name="back" size={16} />{t("back")}
        </Link>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="max-w-[70ch] text-body-sm text-text-2">{t("subtitle")}</p>
      </header>
      {content}
    </div>
  );
  if (!canEdit) return frame(<div className="mz-card"><EmptyState icon="locked" title={t("notAllowed.title")} body={t("notAllowed.body")} /></div>);
  if (query.isError || catalogue.isError) {
    return frame(
      <Alert tone="danger" title={t("loadFailed")}>
        <Button size="sm" variant="secondary" icon="refresh" className="mt-2" onClick={() => { void query.refetch(); void catalogue.refetch(); }}>{t("retry")}</Button>
      </Alert>,
    );
  }
  if (!cur || !catalogue.data) {
    return frame(
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]" aria-busy="true">
        <div className="mz-card"><SkeletonRows rows={6} label={t("loading")} /></div>
        <Skeleton className="hidden h-[640px] rounded-xl xl:block" />
      </div>,
    );
  }

  const cat: Catalogue = catalogue.data;
  const channels: Record<Channel, boolean> = { whatsapp: query.data!.channels.whatsapp, call_auto: query.data!.channels.call_auto, call_team: true };
  const update = (fn: (d: Draft) => Draft) => {
    setDraft((d) => fn(d ?? cur));
    if (saveIssues.length) setSaveIssues([]);
  };
  const setScript = (fn: (s: Script) => Script) => update((d) => ({ ...d, settings: { ...d.settings, script: fn(d.settings.script ?? DEFAULT_SCRIPT) } }));
  const setText = (key: string, value: string | null) => setScript((s) => {
    const texts = { ...(s.texts[lang] as Record<string, string>) };
    if (value === null) delete texts[key]; else texts[key] = value;
    return { ...s, texts: { ...s.texts, [lang]: texts } };
  });
  const setReasons = (next: Reason[] | undefined) => setScript((s) => {
    const { cancelReasons: _old, ...rest } = s;
    void _old;
    return next ? { ...rest, cancelReasons: next } : rest;
  });
  const settings = cur.settings;

  const previewIssues = toIssues(preview.data?.issues, true);
  const issues = mergeIssues(saveIssues, previewIssues);
  const keyGroup = new Map(cat.keys.map((k) => [k.key as string, k.group as string]));
  const issueKeys = new Set(issues.flatMap((i) => (i.target.area === "text" && i.target.lang === lang ? [i.target.key] : [])));
  const nodeHasIssue = (node: NodeId) =>
    keysOf(cat.keys, node).some((k) => issueKeys.has(k.key)) || (node === "cancel" && issues.some((i) => i.target.area === "reason" || i.target.area === "reasons"));
  const edited = (node: NodeId) => keysOf(cat.keys, node).some((k) => (script.texts.ar as Record<string, string>)[k.key] || (script.texts.en as Record<string, string>)[k.key])
    || (node === "cancel" && Boolean(script.cancelReasons));
  const turnText = (keys: readonly string[]) => {
    for (const c of preview.data?.conversations ?? []) for (const turn of c.turns) if (turn.key && keys.includes(turn.key)) return turn.body ?? turn.text ?? "";
    const k = keys.find((x) => (script.texts[lang] as Record<string, string>)[x] || cat.packTexts[script.pack]?.[lang]?.[x]);
    return k ? ((script.texts[lang] as Record<string, string>)[k] ?? cat.packTexts[script.pack]?.[lang]?.[k] ?? "") : "";
  };
  const branches: BranchView[] = BRANCHES.map((b) => {
    const keys = keysOf(cat.keys, b.id).map((k) => k.key as string);
    return { id: b.id, preview: turnText(keys).replace(/\s+/g, " ").slice(0, 80), edited: edited(b.id), issue: nodeHasIssue(b.id) };
  });
  const a = after.data?.settings.confirmed;
  const afterSummary = a ? (a.autoBook.enabled ? t("after.book", { minutes: a.graceMinutes }) : a.graceMinutes > 0 ? t("after.wait", { minutes: a.graceMinutes }) : t("after.ready")) : null;

  // What the client can already tell would be refused (the server stays the judge): only texts the
  // draft changed, as the API; a stored text that no longer fits shows its problem but never blocks.
  const widths = new Map(cat.variables.map((v) => [v.name as string, v.width]));
  const previewFresh = Boolean(preview.data) && !preview.isFetching && debounced === body;
  const textsOk = refusedTexts({
    draft: script.texts as TextsByLang, stored: query.data!.settings.script?.texts as TextsByLang | undefined, keys: cat.keys, widths,
    storeName: store?.tenantName ?? null, issues: previewFresh ? previewIssues : [],
  }).length === 0;
  const hoursValid = settings.callingHours.start < settings.callingHours.end;
  const team = settings.teamCalls;
  const teamValid = Number.isInteger(team.attempts) && team.attempts >= 1 && team.attempts <= 10 && Number.isInteger(team.retryMinutes) && team.retryMinutes >= 10 && team.retryMinutes <= 1440;
  const flowValid = stepsValid(cur.steps);
  const canSave = flowValid && hoursValid && teamValid && textsOk;
  const stepsError = !flowValid ? t("flow.invalid") : saveIssues.some((i) => i.target.area === "steps") ? t("flow.refused") : null;

  // The phone follows the editing: a node or a field whose bubble is not in the chat on screen
  // moves the chat to the sample that has it (with the offer on for the offer's words).
  const showInPhone = (keys: readonly string[], node: NodeId) => {
    const convs = preview.data?.conversations ?? [];
    const next = reveal(convs, keep(convs, sim), keys, SCENARIO_OF[node]);
    if (!next) return;
    if (next.scenario === "confirm_offer" || next.scenario === "offer_no") setOffer(true);
    setSim(next);
  };
  const focusKeyIn = (key: string | null) => {
    setFocusKey(key);
    if (key) showInPhone([key], nodeOf(key, keyGroup.get(key) ?? ""));
  };
  const select = (node: NodeId) => {
    setSelected(node);
    setFocusKey(node === "team" ? "call" : null);
    if (node !== "team") showInPhone(keysOf(cat.keys, node).map((k) => k.key as string), node);
  };
  /** `later`: the field is not on screen yet (another language is coming), focus it after the render. */
  const editKey = (key: string, later = false) => {
    setSelected(nodeOf(key, keyGroup.get(key) ?? ""));
    focusKeyIn(key);
    // Already on screen (nothing re-renders when the node and key are the same): focus it now.
    const el = phoneOpen || later ? null : document.getElementById(fieldId(key));
    if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: "center", behavior: scrollBehavior() }); }
    else pendingFocus.current = key;
    setPhoneOpen(false);
  };
  function goTo(issue: StudioIssue) {
    const tg = issue.target;
    // A field of the other language remounts when the language changes: focus it after that render.
    if (tg.area === "text") { setLang(tg.lang); editKey(tg.key, tg.lang !== lang); }
    else if (tg.area === "reason" || tg.area === "reasons") { if (tg.area === "reason" && tg.lang) setLang(tg.lang); setSelected("cancel"); }
    else if (tg.area === "team") setSelected("team");
    else if (tg.area === "steps") document.querySelector("[data-testid=studio-flow]")?.scrollIntoView({ block: "center", behavior: scrollBehavior() });
  }
  const closeInspector = () => {
    setSelected(null);
    setFocusKey(null);
    const back = opener.current;
    (back?.isConnected ? back : document.querySelector<HTMLElement>("[data-testid=studio-flow]"))?.focus();
  };
  const selectFromFlow = (node: NodeId) => {
    const el = document.activeElement;
    opener.current = el instanceof HTMLElement && el !== document.body ? el : null;
    select(node);
  };
  const view = selected === "team" ? "call" : focusKey === "link_text" ? "link" : "chat";
  const langTexts = Object.keys(script.texts[lang] ?? {}).length;

  const phone = (
    <StudioPhone preview={preview.data} lang={preview.data?.lang ?? lang} chrome={chrome[preview.data?.lang ?? lang]} storeName={store?.tenantName ?? ""} logo={store?.tenantLogo ?? null}
      loading={preview.isFetching || debounced !== body} failed={preview.isError} activeKey={focusKey} issueKeys={issueKeys} onEdit={editKey}
      sim={sim} onSim={setSim} offer={offer} onOffer={setOffer} view={view} />
  );
  const teamEditor = selected === "team" ? (
    <div className="flex flex-col gap-4" data-testid="team-editor">
      <div className="flex flex-wrap gap-3">
        <Field label={t("team.attempts")} hint={t("team.attemptsHint")} type="number" ltr min={1} max={10} value={team.attempts} style={{ inlineSize: "9rem" }}
          onChange={(e) => update((d) => ({ ...d, settings: { ...d.settings, teamCalls: { ...d.settings.teamCalls, attempts: Math.round(Number(e.target.value)) } } }))} />
        <Field label={t("team.retry")} hint={t("team.retryHint")} type="number" ltr min={10} max={1440} step={10} value={team.retryMinutes} style={{ inlineSize: "9rem" }}
          onChange={(e) => update((d) => ({ ...d, settings: { ...d.settings, teamCalls: { ...d.settings.teamCalls, retryMinutes: Math.round(Number(e.target.value)) } } }))} />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mz-label">{t("team.hours")}</legend>
        <p className="mz-hint">{t("team.hoursHint")}</p>
        <div className="flex flex-wrap gap-3">
          <Field label={t("team.from")} type="time" ltr value={settings.callingHours.start} style={{ inlineSize: "9rem" }} error={hoursValid ? null : t("team.hoursInvalid")}
            onChange={(e) => update((d) => ({ ...d, settings: { ...d.settings, callingHours: { ...d.settings.callingHours, start: e.target.value } } }))} />
          <Field label={t("team.until")} type="time" ltr value={settings.callingHours.end} style={{ inlineSize: "9rem" }}
            onChange={(e) => update((d) => ({ ...d, settings: { ...d.settings, callingHours: { ...d.settings.callingHours, end: e.target.value } } }))} />
        </div>
      </fieldset>
    </div>
  ) : null;

  return frame(
    <>
      <div className="mz-card flex flex-wrap items-end gap-x-4 gap-y-3 p-4" role="toolbar" aria-label={t("toolbar.label")} data-testid="studio-toolbar">
        <div className="flex flex-col gap-1.5">
          <span className="mz-label" id="studio-pack">{t("toolbar.pack")}</span>
          <Segmented label={t("toolbar.pack")} value={script.pack} onChange={(pack) => setScript((s) => ({ ...s, pack }))}
            options={PACKS.map((p) => ({ value: p, label: t(`packs.${p}`) }))} />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="mz-label">{t("toolbar.language")}</span>
          <Segmented label={t("toolbar.language")} value={lang} onChange={(l) => { setLang(l); setFocusKey(null); }}
            options={[{ value: "ar", label: t("toolbar.ar"), lang: "ar" }, { value: "en", label: t("toolbar.en"), lang: "en" }]} />
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {issues.length ? (
            <button type="button" onClick={() => goTo(issues[0]!)} data-testid="studio-issues"
              className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-3 py-1.5 text-body-sm text-danger-text hover:underline">
              <Icon name="warning" size={14} />{t("toolbar.issues", { count: issues.length })}
            </button>
          ) : preview.data ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-success-soft px-3 py-1.5 text-body-sm text-success-text" data-testid="studio-issues-none">
              <Icon name="success" size={14} />{t("toolbar.noIssues")}
            </span>
          ) : null}
          <Button size="sm" variant="ghost" icon="refresh" disabled={!langTexts} onClick={() => setRestoring(true)}>{t("toolbar.restore")}</Button>
        </div>
      </div>

      {saveIssues.length ? <Alert tone="danger" title={t("refused.title")}>{t("refused.body", { count: saveIssues.length })}</Alert> : null}
      {saveError ? (
        <Alert tone="danger" title={t("saveFailed")}>
          <Button size="sm" variant="secondary" icon="refresh" className="mt-2" busy={save.isPending}
            onClick={() => save.mutate({ ...settings, steps: withoutIds(cur.steps), script: cleanScript(script) })}>{t("retry")}</Button>
        </Alert>
      ) : null}

      <div className={cx("grid items-start gap-6", wide && "grid-cols-[minmax(0,1fr)_360px]")}>
        <div className="flex min-w-0 flex-col gap-5">
          <StudioFlow steps={cur.steps} channels={channels} enabled={settings.enabled} newId={nextStepId}
            onSteps={(steps) => update((d) => ({ ...d, steps }))} selected={selected} onSelect={selectFromFlow}
            branches={branches} offerSummary={{ edited: edited("offer"), issue: nodeHasIssue("offer") }} afterSummary={afterSummary} stepsError={stepsError} />
          {selected && selected !== "trigger" && selected !== "steps" ? (
            <Inspector node={selected} catalogue={cat} script={script} lang={lang} storeName={store?.tenantName ?? null} issues={issues}
              onText={setText} onReasons={setReasons} newReasonId={newReasonId} onFocusKey={focusKeyIn} onClose={closeInspector}
              team={teamEditor} />
          ) : (
            <p className="text-body-sm text-text-3">{t("inspector.pick")}</p>
          )}
        </div>
        {wide ? <aside className="sticky top-20" aria-label={t("phone.aside")}>{phone}</aside> : null}
      </div>

      <SaveBar dirty={draft !== null} busy={save.isPending} canSave={canSave}
        onSave={() => save.mutate({ ...settings, steps: withoutIds(cur.steps), script: cleanScript(script) })}
        onDiscard={() => { setDraft(null); setSaveIssues([]); setSaveError(null); }} />

      {!wide ? (
        <>
          <button type="button" onClick={() => setPhoneOpen(true)} data-testid="open-phone"
            className={cx("mz-btn mz-btn--primary fixed end-4 z-30 shadow-overlay", draft ? "bottom-[calc(160px+env(safe-area-inset-bottom,0px))] lg:bottom-24" : "bottom-[calc(96px+env(safe-area-inset-bottom,0px))] lg:bottom-6")}>
            <Icon name="message" size={16} />{t("phone.open")}
          </button>
          <Dialog open={phoneOpen} onClose={() => setPhoneOpen(false)} title={t("phone.title")} className="w-[min(420px,calc(100vw-24px))] max-h-[calc(100dvh-24px)] overflow-y-auto">
            {phone}
          </Dialog>
        </>
      ) : null}

      <ConfirmDialog open={restoring} onClose={() => setRestoring(false)} title={t("restore.title")} description={t("restore.body", { lang: t(`toolbar.${lang}`) })} confirmLabel={t("restore.confirm")}
        onConfirm={() => { setRestoring(false); setScript((s) => ({ ...s, texts: { ...s.texts, [lang]: {} } })); }} />
    </>,
  );
}
