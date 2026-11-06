"use client";

import {
  closestCenter, DndContext, DragOverlay, PointerSensor, TouchSensor, useDraggable, useSensor, useSensors,
  type Announcements, type DragEndEvent, type DragStartEvent, type Modifier, type UniqueIdentifier,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import { useTranslations } from "next-intl";
import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { MenuButton, type MenuItem } from "@/components/ui/Menu";
import { Tooltip } from "@/components/ui/Tooltip";
import { cx } from "@/components/ui/logic";
import { Link } from "@/i18n/navigation";
import { cannotAdd, insertStep, lastMovable, MAX_WAIT, MIN_WAIT, moveStep, removeStep, setWait, waitValid, type Channel, type FlowStep } from "./flow";
import { useKeyboardSort } from "./keyboard-sort";
import { BRANCHES, type BranchId, type NodeId } from "./nodes";

export const CHANNEL_ICON: Record<Channel, IconProps["name"]> = { whatsapp: "message", call_auto: "call-outgoing", call_team: "call" };
const PALETTE: readonly Channel[] = ["whatsapp", "call_auto", "call_team"];
const PALETTE_PREFIX = "palette:";

/** Drags move up and down only (the lane is a column). */
const vertical: Modifier = ({ transform }) => ({ ...transform, x: 0 });

export interface BranchView { id: BranchId; preview: string; edited: boolean; issue: boolean }

/** A six-dot grip (the design system has no icon for it). */
function Grip() {
  return (
    <svg width="14" height="18" viewBox="0 0 14 18" fill="currentColor" aria-hidden="true">
      {[3, 9, 15].flatMap((y) => [4, 10].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />))}
    </svg>
  );
}

/**
 * The flow (E6-16b): a new order arrives → the cascade of steps (sortable: pointer, touch and
 * keyboard; the team call pinned last) → under the first WhatsApp step, what the buyer can do.
 */
export function StudioFlow({ steps, channels, enabled, onSteps, newId, selected, onSelect, branches, offerSummary, afterSummary, stepsError }: {
  steps: FlowStep[];
  channels: Record<Channel, boolean>;
  enabled: boolean;
  onSteps(next: FlowStep[]): void;
  newId(): string;
  selected: NodeId | null;
  onSelect(node: NodeId): void;
  branches: readonly BranchView[];
  offerSummary: { edited: boolean; issue: boolean };
  afterSummary: string | null;
  stepsError: string | null;
}) {
  const t = useTranslations("confirmationStudio.flow");
  const [dragging, setDragging] = useState<UniqueIdentifier | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  );
  const name = (c: Channel) => t(`channel.${c}`);
  const describe = (id: UniqueIdentifier | undefined | null) => {
    const sid = String(id ?? "");
    if (sid.startsWith(PALETTE_PREFIX)) return name(sid.slice(PALETTE_PREFIX.length) as Channel);
    const i = steps.findIndex((s) => s.id === sid);
    return i >= 0 ? t("dnd.step", { n: i + 1, channel: name(steps[i]!.channel) }) : "";
  };
  const position = (id: UniqueIdentifier | undefined | null) => steps.findIndex((s) => s.id === String(id ?? "")) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => t("dnd.picked", { item: describe(active.id) }),
    onDragOver: ({ active, over }) => (over ? t("dnd.over", { item: describe(active.id), n: Math.max(1, position(over.id)) }) : t("dnd.outside", { item: describe(active.id) })),
    onDragEnd: ({ active, over }) => (over ? t("dnd.dropped", { item: describe(active.id), n: Math.max(1, position(over.id)) }) : t("dnd.cancelled", { item: describe(active.id) })),
    onDragCancel: ({ active }) => t("dnd.cancelled", { item: describe(active.id) }),
  };

  const keys = useKeyboardSort({
    items: steps, idOf: (s) => s.id, onChange: onSteps,
    move: (items, from, by) => moveStep(items, from, from + by),
    say: {
      picked: (s, i) => t("dnd.picked", { item: t("dnd.step", { n: i + 1, channel: name(s.channel) }) }),
      moved: (s, i) => t("dnd.over", { item: name(s.channel), n: i + 1 }),
      dropped: (s, i) => t("dnd.dropped", { item: name(s.channel), n: i + 1 }),
      cancelled: (s) => t("dnd.cancelled", { item: name(s.channel) }),
    },
  });
  const add = (channel: Channel, at?: number) => onSteps(insertStep(steps, { id: newId(), channel, waitMinutes: 60 }, at));
  const onDragStart = (e: DragStartEvent) => setDragging(e.active.id);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    const aid = String(active.id);
    if (aid.startsWith(PALETTE_PREFIX)) {
      if (!over) return;
      const channel = aid.slice(PALETTE_PREFIX.length) as Channel;
      const at = steps.findIndex((s) => s.id === String(over.id));
      // Below the middle of the card it lands on: after it.
      const box = active.rect.current.translated;
      const below = box ? box.top + box.height / 2 > over.rect.top + over.rect.height / 2 : false;
      add(channel, at >= 0 ? at + (below ? 1 : 0) : undefined);
      return;
    }
    if (!over || over.id === active.id) return;
    const from = steps.findIndex((s) => s.id === aid);
    const to = steps.findIndex((s) => s.id === String(over.id));
    if (from >= 0 && to >= 0) onSteps(moveStep(steps, from, to));
  };
  const firstWhatsApp = steps.findIndex((s) => s.channel === "whatsapp");
  const paletteDrag = String(dragging ?? "").startsWith(PALETTE_PREFIX) ? (String(dragging).slice(PALETTE_PREFIX.length) as Channel) : null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} modifiers={[vertical]} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}
      accessibility={{ announcements, screenReaderInstructions: { draggable: t("dnd.instructions") } }}>
      <ol className="flex flex-col" aria-label={t("label")} data-testid="studio-flow">
        <FlowNode connector>
          <div className="mz-card flex flex-wrap items-center gap-3 p-4" data-testid="flow-trigger">
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-sunk text-text-2"><Icon name="orders" size={18} /></span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-label">{t("trigger")}</span>
              <span className="text-caption text-text-3">{t("triggerHint")}</span>
            </span>
            <Badge tone={enabled ? "success" : "neutral"}>{t(enabled ? "on" : "off")}</Badge>
            <Link href="/settings/confirmation" className="text-body-sm text-text-2 underline-offset-2 hover:text-text hover:underline">{t("change")}</Link>
          </div>
        </FlowNode>

        <FlowNode connector>
          <div className="flex flex-col gap-2" data-testid="flow-palette">
            <p className="text-caption text-text-3">{t("palette")}</p>
            <ul className="flex flex-wrap gap-2">
              {PALETTE.map((c) => {
                const why = cannotAdd(steps, c);
                return <li key={c}><PaletteChip channel={c} label={name(c)} disabled={why} reason={why ? t(`cannot.${why}`) : null} onAdd={() => add(c)} /></li>;
              })}
            </ul>
          </div>
        </FlowNode>

        <SortableContext items={steps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {steps.map((s, i) => (
            <StepNode key={s.id} step={s} index={i} steps={steps} connected={channels[s.channel]} onSteps={onSteps} keyboard={keys.handleProps(s.id)} lifted={keys.lifted === s.id}
              selected={selected === "team" && s.channel === "call_team"} onSelectTeam={() => onSelect("team")}>
              {i === firstWhatsApp ? (
                <Branches branches={branches} selected={selected} onSelect={onSelect} offer={offerSummary} after={afterSummary} />
              ) : null}
            </StepNode>
          ))}
        </SortableContext>
        {firstWhatsApp < 0 ? (
          <FlowNode connector>
            <div className="mz-card flex flex-wrap items-center gap-3 border-dashed p-4" data-testid="flow-no-whatsapp">
              <Icon name="message" size={18} className="text-text-3" />
              <p className="min-w-0 flex-1 text-body-sm text-text-2">{t("noWhatsApp")}</p>
              <Button size="sm" variant="secondary" icon="add" disabled={Boolean(cannotAdd(steps, "whatsapp"))} onClick={() => add("whatsapp", 0)}>{t("addWhatsApp")}</Button>
            </div>
          </FlowNode>
        ) : null}
        <FlowNode>
          <div className="flex items-center gap-2 ps-4 text-body-sm text-text-2">
            <Icon name="customer" size={16} />{t(steps.some((s) => s.channel === "call_team") ? "endTeam" : "endList")}
          </div>
        </FlowNode>
      </ol>
      <p className="sr-only" aria-live="assertive" aria-atomic="true">{keys.announcement}</p>
      {stepsError ? <p role="alert" className="mt-2 text-body-sm text-danger">{stepsError}</p> : null}
      <DragOverlay dropAnimation={null}>
        {paletteDrag ? <span className="mz-card inline-flex items-center gap-2 px-3 py-2 text-body-sm shadow-overlay"><Icon name={CHANNEL_ICON[paletteDrag]} size={16} />{name(paletteDrag)}</span> : null}
      </DragOverlay>
    </DndContext>
  );
}

/** A node of the flow with the line down to the next one (logical, so it mirrors in Arabic). */
function FlowNode({ children, connector = false }: { children: ReactNode; connector?: boolean }) {
  return (
    <li className="relative flex flex-col pb-5">
      {children}
      {connector ? <span aria-hidden="true" className="absolute bottom-0 start-7 h-5 border-s-2 border-line-strong" /> : null}
    </li>
  );
}

function PaletteChip({ channel, label, disabled, reason, onAdd }: { channel: Channel; label: string; disabled: string | null; reason: string | null; onAdd(): void }) {
  const t = useTranslations("confirmationStudio.flow");
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `${PALETTE_PREFIX}${channel}`, disabled: Boolean(disabled) });
  // Pointer and touch drag the chip; on the keyboard, Enter or Space simply adds the step.
  const { onKeyDown: _keyboardDrag, ...pointer } = listeners ?? {};
  void _keyboardDrag;
  const chip = (
    <button ref={setNodeRef} type="button" {...attributes} {...pointer} aria-disabled={disabled ? true : undefined}
      aria-label={t("addChip", { channel: label })}
      className={cx("mz-card inline-flex touch-none items-center gap-2 px-3 py-2 text-body-sm", disabled ? "cursor-not-allowed text-text-3" : "cursor-grab hover:bg-surface-hover", isDragging && "opacity-50")}
      onClick={() => { if (!disabled) onAdd(); }}>
      <Icon name={CHANNEL_ICON[channel]} size={16} />{label}<Icon name="add" size={14} className="text-text-3" />
    </button>
  );
  return reason ? <Tooltip content={reason}>{chip}</Tooltip> : chip;
}

function StepNode({ step, index, steps, connected, onSteps, selected, onSelectTeam, keyboard, lifted, children }: {
  keyboard: ReturnType<ReturnType<typeof useKeyboardSort<FlowStep>>["handleProps"]>; lifted: boolean;
  step: FlowStep; index: number; steps: FlowStep[]; connected: boolean; onSteps(next: FlowStep[]): void; selected: boolean; onSelectTeam(): void; children?: ReactNode;
}) {
  const t = useTranslations("confirmationStudio.flow");
  const team = step.channel === "call_team";
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: step.id, disabled: team });
  const last = index === steps.length - 1;
  const items: MenuItem[] = [];
  if (!team && index > 0) items.push({ id: "up", label: t("moveUp"), icon: "arrow-up", onSelect: () => onSteps(moveStep(steps, index, index - 1)) });
  if (!team && index < lastMovable(steps)) items.push({ id: "down", label: t("moveDown"), icon: "arrow-down", onSelect: () => onSteps(moveStep(steps, index, index + 1)) });
  if (steps.length > 1) items.push({ id: "remove", label: t("remove"), icon: "delete", danger: true, separatorBefore: items.length > 0, onSelect: () => onSteps(removeStep(steps, index)) });
  const wait = (
    <input type="number" dir="ltr" inputMode="numeric" min={MIN_WAIT} max={MAX_WAIT} step={10} value={step.waitMinutes}
      aria-label={t("waitLabel", { n: index + 1 })} aria-invalid={waitValid(step.waitMinutes) ? undefined : true}
      className="mz-input mz-num mx-1 text-center" style={{ inlineSize: "5.5rem", blockSize: "2rem" }}
      onChange={(e) => onSteps(setWait(steps, index, Math.round(Number(e.target.value))))} />
  );
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cx("relative flex flex-col pb-5", isDragging && "z-10")}
      data-testid="flow-step" data-channel={step.channel}>
      <div className={cx("mz-card flex flex-col gap-3 p-3 sm:p-4", (isDragging || lifted) && "shadow-overlay ring-2 ring-focus", selected && "ring-2 ring-focus")}>
        <div className="flex flex-wrap items-center gap-2">
          {team ? (
            <Tooltip content={t("pinned")}>
              <span tabIndex={0} className="grid size-8 place-items-center rounded-md text-text-3" aria-label={t("pinned")}><Icon name="locked" size={16} /></span>
            </Tooltip>
          ) : (
            <button type="button" {...attributes} {...listeners} {...keyboard} ref={(el) => { setActivatorNodeRef(el); keyboard.ref(el); }}
              aria-label={t("handle", { n: index + 1, channel: t(`channel.${step.channel}`) })}
              className="grid size-8 cursor-grab touch-none place-items-center rounded-md text-text-3 hover:bg-surface-hover hover:text-text" data-testid="step-handle">
              <Grip />
            </button>
          )}
          <span className="grid size-6 place-items-center rounded-full bg-surface-sunk text-caption font-medium" aria-hidden="true"><bdi>{index + 1}</bdi></span>
          <Icon name={CHANNEL_ICON[step.channel]} size={18} />
          <span className="text-label" data-testid="step-name">{t(`channel.${step.channel}`)}</span>
          {!connected ? <Badge tone="warning">{t("notConnected")}</Badge> : null}
          <span className="ms-auto flex items-center gap-1">
            {team ? <Button size="sm" variant="secondary" icon="edit" onClick={onSelectTeam} aria-pressed={selected}>{t("editCall")}</Button> : null}
            {items.length ? <MenuButton label={t("more", { n: index + 1 })} items={items} /> : null}
          </span>
        </div>
        {team ? (
          <p className="text-body-sm text-text-2">{t("teamBody")}</p>
        ) : (
          <p className="flex flex-wrap items-center text-body-sm text-text-2">
            {t.rich(last ? "waitLast" : "wait", { input: () => wait })}
          </p>
        )}
        {!connected && !team ? <p className="text-caption text-text-3">{t(`skipped.${step.channel}`)}</p> : null}
      </div>
      {children}
      {!last ? <span aria-hidden="true" className="absolute bottom-0 start-7 h-5 border-s-2 border-line-strong" /> : null}
    </li>
  );
}

const BRANCH_ICON = Object.fromEntries(BRANCHES.map((b) => [b.id, b.icon])) as Record<BranchId, IconProps["name"]>;

/** What the buyer can do in the chat: each a node that opens its wording in the inspector. */
function Branches({ branches, selected, onSelect, offer, after }: {
  branches: readonly BranchView[]; selected: NodeId | null; onSelect(node: NodeId): void; offer: { edited: boolean; issue: boolean }; after: string | null;
}) {
  const t = useTranslations("confirmationStudio");
  return (
    <section className="relative mt-3 ms-4 flex flex-col gap-2 border-s-2 border-line-strong ps-4 sm:ms-7" aria-label={t("branches.label")} data-testid="flow-branches">
      <h3 className="text-overline uppercase text-text-3">{t("branches.label")}</h3>
      <ul className="grid gap-2 sm:grid-cols-2">
        {branches.map((b) => (
          <li key={b.id} className={cx(b.id === "confirms" && "sm:col-span-2")}>
            <div className={cx("mz-card flex h-full flex-col gap-2 p-0", selected === b.id && "ring-2 ring-focus")}>
              <button type="button" aria-pressed={selected === b.id} onClick={() => onSelect(b.id)} data-testid={`node-${b.id}`}
                className="flex w-full items-start gap-3 rounded-lg p-3 text-start hover:bg-surface-hover">
                <span className="relative grid size-8 shrink-0 place-items-center rounded-full bg-surface-sunk text-text-2">
                  <Icon name={BRANCH_ICON[b.id]} size={16} />
                  {b.issue ? <span className="absolute -top-0.5 -end-0.5 size-2.5 rounded-full bg-danger" aria-hidden="true" /> : null}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-label">{t(`nodes.${b.id}.title`)}</span>
                    {b.edited ? <Badge tone="info" dot={false}>{t("branches.edited")}</Badge> : null}
                    {b.issue ? <span className="sr-only">{t("branches.hasIssue")}</span> : null}
                  </span>
                  <span className="line-clamp-2 text-caption text-text-3" dir="auto">{b.preview}</span>
                </span>
              </button>
              {b.id === "confirms" ? (
                <div className="flex flex-wrap gap-2 px-3 pb-3">
                  <button type="button" onClick={() => onSelect("offer")} aria-pressed={selected === "offer"} data-testid="node-offer"
                    className={cx("inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-caption hover:bg-surface-hover", selected === "offer" && "ring-2 ring-focus")}>
                    <Icon name="discount" size={14} />{t("branches.offer")}
                    {offer.edited ? <span className="text-text-3">{" · "}{t("branches.edited")}</span> : null}
                    {offer.issue ? <span className="size-2 rounded-full bg-danger" aria-label={t("branches.hasIssue")} /> : null}
                  </button>
                  <Link href="/settings/after-confirmation" className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1 text-caption text-text-2 hover:bg-surface-hover">
                    <Icon name="shipping" size={14} />{after ? t("branches.after", { summary: after }) : t("branches.afterNone")}<Icon name="chevron-end" size={12} />
                  </Link>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
