"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Tooltip } from "@/components/ui/Tooltip";
import { cx } from "@/components/ui/logic";
import { scrollBehavior } from "./motion";
import { parseWhatsApp, plainText, type WaNode } from "./whatsapp-format";
import s from "./WhatsAppPhone.module.css";
import { Waiting } from "@/components/ui/Loader";

/** One turn of a preview conversation (the API's PreviewTurn). */
export interface PhoneTurn {
  from: "business" | "customer";
  kind: "template" | "text" | "buttons" | "list" | "tap" | "typed";
  key?: string;
  editable: boolean;
  header?: string;
  body?: string;
  text?: string;
  footer?: string;
  buttons?: string[];
  list?: { button: string; section?: string; rows: Array<{ title: string; description?: string }> };
}

/** WhatsApp's own words in the buyer's language (messages: whatsappPhone.chrome, read from that language's file). */
export interface PhoneChrome { today: string; business: string; typing: string; message: string; send: string; notice: string; customer: string; calling: string }

export interface PhoneReply { id: string; label: string; hint?: string }

export interface WhatsAppPhoneProps {
  /** The buyer's language: the chat's direction and WhatsApp's words. */
  lang: "ar" | "en";
  chrome: PhoneChrome;
  storeName: string;
  logo?: string | null;
  turns: readonly PhoneTurn[];
  /** The store is writing (the next reply is on its way). */
  typing?: boolean;
  /** A new preview is loading. */
  loading?: boolean;
  /** The key being edited: its bubble gets the focus ring. */
  activeKey?: string | null;
  issueKeys?: ReadonlySet<string>;
  onEdit?(key: string): void;
  /** Pulse the template's buttons ("tap a button"). */
  pulse?: boolean;
  onTemplate?(index: number): void;
  /** The turn whose buttons or list the buyer can use now. */
  tapOn?: number | null;
  onButton?(turn: number, index: number): void;
  onList?(turn: number, title: string): void;
  /** The buyer's own title for a turn (the list row they chose). */
  chosen?: { at: number; title: string };
  replies?: readonly PhoneReply[];
  onReply?(id: string): void;
  view?: "chat" | "call" | "link";
  call?: readonly string[];
  link?: string;
  label: string;
  /** Scroll the chat to the newest turn as it grows (the simulation); off for a static sample. */
  follow?: boolean;
}

const TIME = "10:42";
const CLOCK = "9:41";

/** The phone's status bar icons, drawn (the design system has none for them). */
function StatusIcons() {
  return (
    <span className={s.statusIcons} aria-hidden="true">
      <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor"><rect x="0" y="7" width="3" height="4" rx="1" /><rect x="4.5" y="5" width="3" height="6" rx="1" /><rect x="9" y="2.5" width="3" height="8.5" rx="1" /><rect x="13.5" y="0" width="3" height="11" rx="1" /></svg>
      <svg width="15" height="11" viewBox="0 0 15 11" fill="currentColor"><path d="M7.5 2.2c2.1 0 4 .8 5.5 2.2l1.1-1.1A9.3 9.3 0 0 0 7.5.6 9.3 9.3 0 0 0 .9 3.3L2 4.4a7.7 7.7 0 0 1 5.5-2.2Zm0 3.1c1.2 0 2.4.5 3.3 1.3l1.1-1.1a6.3 6.3 0 0 0-8.8 0l1.1 1.1c.9-.8 2.1-1.3 3.3-1.3Zm0 3.1c-.5 0-.9.2-1.2.5L7.5 10l1.2-1.1c-.3-.3-.7-.5-1.2-.5Z" /></svg>
      <svg width="25" height="12" viewBox="0 0 25 12" fill="none"><rect x="0.5" y="0.5" width="21" height="11" rx="3.5" stroke="currentColor" opacity="0.4" /><rect x="2" y="2" width="16" height="8" rx="2" fill="currentColor" /><path d="M23 4v4c.8-.3 1.3-1.1 1.3-2S23.8 4.3 23 4Z" fill="currentColor" opacity="0.5" /></svg>
    </span>
  );
}

const Ticks = () => (
  <svg className={s.tick} width="16" height="11" viewBox="0 0 16 11" fill="none" aria-hidden="true">
    <path d="M11.1 1 5.3 7.9 2.9 5.6 2 6.6l3.4 3.2L12 1.8 11.1 1Z" fill="currentColor" /><path d="M14.6 1 8.8 7.9l-.9-.9-.9 1 1.9 1.8 6.6-8-.9-.8Z" fill="currentColor" />
  </svg>
);
const ReplyArrow = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={s.mirror}>
    <path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </svg>
);

/** WhatsApp formatting as React nodes (never HTML). Links look real but never navigate in the preview. */
function Rich({ nodes }: { nodes: readonly WaNode[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.type) {
          case "text": return <Fragment key={i}>{n.text}</Fragment>;
          case "br": return <br key={i} />;
          case "bold": return <strong key={i}><Rich nodes={n.children} /></strong>;
          case "italic": return <em key={i}><Rich nodes={n.children} /></em>;
          case "strike": return <s key={i}><Rich nodes={n.children} /></s>;
          case "mono": return <code key={i} className={s.mono}>{n.text}</code>;
          case "link": return <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" className={s.link} dir="ltr" onClick={(e) => e.preventDefault()}>{n.text}</a>;
        }
      })}
    </>
  );
}
export const WaText = ({ text }: { text: string }) => <Rich nodes={parseWhatsApp(text)} />;

/**
 * The time (and the buyer's ticks) at the end of the bubble's last line, as WhatsApp draws it: the
 * text ends with a spacer as wide as the time, and the time sits over it at the bottom corner, so it
 * shares the last line when it fits and gets its own line when it does not. The outer span keeps
 * the chat's direction (its corner and gap mirror in Arabic); the inner one reads left to right.
 */
function Meta({ out }: { out: boolean }) {
  return <span className={cx(s.meta, out && s.metaOut)}><span className={s.metaInner} dir="ltr"><bdi>{TIME}</bdi>{out ? <Ticks /> : null}</span></span>;
}
const MetaSpace = ({ out }: { out: boolean }) => <span className={cx(s.metaSpace, out && s.metaSpaceOut)} aria-hidden="true" />;

function Avatar({ name, logo, className }: { name: string; logo?: string | null; className?: string }) {
  const initial = Array.from(name.trim())[0] ?? "";
  return (
    <span className={cx(s.avatar, className)} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element -- the store's logo from Shopify, any host */}
      {logo ? <img src={logo} alt="" /> : initial.toLocaleUpperCase()}
    </span>
  );
}

/**
 * The studio's phone (E6-16b): the buyer's WhatsApp chat as the buyer sees it, with the store's
 * draft wording. Editable bubbles are buttons that open their text in the studio; the template's
 * buttons, the offer's buttons, the cancel list and the composer drive the simulation.
 */
export function WhatsAppPhone(p: WhatsAppPhoneProps) {
  const t = useTranslations("whatsappPhone");
  const dir = p.lang === "ar" ? "rtl" : "ltr";
  const chat = useRef<HTMLDivElement>(null);
  const [sheet, setSheet] = useState<number | null>(null);
  const [repliesOpen, setRepliesOpen] = useState(false);
  const view = p.view ?? "chat";

  // The newest turn into view as the chat grows (the simulation).
  const count = p.turns.length;
  useEffect(() => {
    if (!p.follow) return;
    const el = chat.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, p.typing, p.follow]);
  // The bubble being edited into view.
  useEffect(() => {
    if (!p.activeKey) return;
    chat.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(p.activeKey)}"]`)?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
  }, [p.activeKey, count]);
  // What the buyer just received, for screen readers: the store's newest reply, once, when the
  // simulation adds it (not when a new preview rewords the chat on screen).
  const [said, setSaid] = useState<{ count: number; text: string }>({ count, text: "" });
  if (said.count !== count) {
    const last = p.turns[count - 1];
    const fresh = p.follow && count > said.count && last?.from === "business";
    setSaid({ count, text: fresh && last ? plainText(parseWhatsApp([last.header, last.body ?? last.text, last.footer].filter(Boolean).join("\n"))) : said.text });
  }

  const groupStart = (i: number) => i === 0 || p.turns[i - 1]!.from !== p.turns[i]!.from;
  const header = view === "link" ? p.chrome.customer : p.storeName;

  return (
    <figure className={s.phone} aria-label={p.label} data-testid="whatsapp-phone">
      <div className={s.frame}>
        <div className={s.screen} dir={dir} lang={p.lang}>
          <div className={s.status}>
            <bdi>{CLOCK}</bdi>
            <span className={s.island} aria-hidden="true" />
            <StatusIcons />
          </div>
          {view === "call" ? (
            <CallSheet lines={p.call ?? []} name={p.chrome.customer} sub={p.chrome.calling} label={t("callScript")} />
          ) : (
            <>
              <header className={s.header}>
                <Icon name="back" size={20} className={s.headerIcon} />
                <Avatar name={header} logo={view === "link" ? null : p.logo} />
                <span className={s.who}>
                  <span className={s.name}>{header}</span>
                  {view === "chat" ? (
                    <span className={cx(s.sub, p.typing && s.subTyping)}>{p.typing ? p.chrome.typing : p.chrome.business}</span>
                  ) : null}
                </span>
                {p.loading ? <span role="status" className="inline-flex shrink-0"><span className="mz-sr">{t("loading")}</span><Waiting meaning="loading" size={14} /></span> : null}
                <Icon name="call" size={19} className={s.headerIcon} />
                <Icon name="more-vertical" size={19} className={s.headerIcon} />
              </header>
              {p.follow ? <p className="sr-only" aria-live="polite" aria-atomic="true" data-testid="phone-said">{said.text}</p> : null}
              <div ref={chat} className={s.chat}>
                <div className={s.pills}>
                  <span className={s.datePill}>{p.chrome.today}</span>
                  {view === "chat" ? <span className={s.noticePill}>{p.chrome.notice}</span> : null}
                </div>
                {view === "link" ? (
                  <ol className={s.turns} aria-label={t("chat")}>
                    <li className={cx(s.row, s.rowOut, s.rowFirst)}>
                      <div className={cx(s.bubble, s.bubbleOut, s.tailOut, s.active)} data-key="link_text">
                        <div className={s.content}>
                          <span className={s.body} dir="auto"><WaText text={p.link ?? ""} /><MetaSpace out /></span>
                          <Meta out />
                        </div>
                      </div>
                    </li>
                  </ol>
                ) : (
                  <ol className={s.turns} aria-label={t("chat")}>
                    {p.turns.map((turn, i) => (
                      <Turn key={`${i}-${turn.kind}-${turn.key ?? ""}`} turn={turn} index={i} first={groupStart(i)} p={p}
                        text={p.chosen?.at === i ? p.chosen.title : undefined} onOpenList={() => setSheet(i)} />
                    ))}
                    {p.typing ? (
                      <li className={cx(s.row, s.rowIn, s.rowFirst)} aria-hidden="true">
                        <div className={cx(s.bubble, s.bubbleIn, s.tailIn)}><span className={s.typing}><span /><span /><span /></span></div>
                      </li>
                    ) : null}
                  </ol>
                )}
              </div>
              <div className={s.composer}>
                {repliesOpen && p.replies?.length ? (
                  <Replies replies={p.replies} label={t("replies")} onClose={() => setRepliesOpen(false)} onPick={(id) => { setRepliesOpen(false); p.onReply?.(id); }} />
                ) : null}
                <button type="button" className={s.composerPill} aria-haspopup={p.replies?.length ? "menu" : undefined} aria-expanded={p.replies?.length ? repliesOpen : undefined}
                  aria-label={t("write")} disabled={!p.replies?.length} onClick={() => setRepliesOpen((o) => !o)}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5s1.3 1.8 3.5 1.8 3.5-1.8 3.5-1.8" strokeLinecap="round" /><circle cx="9" cy="10" r="1" fill="currentColor" /><circle cx="15" cy="10" r="1" fill="currentColor" /></svg>
                  <span>{p.chrome.message}</span>
                  <Icon name="attach" size={20} />
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
                </button>
                <span className={s.mic} aria-hidden="true">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-6a3.5 3.5 0 1 0-7 0v6A3.5 3.5 0 0 0 12 15Zm6-3.5a6 6 0 0 1-12 0H4.5a7.5 7.5 0 0 0 6.75 7.46V21h1.5v-2.04a7.5 7.5 0 0 0 6.75-7.46H18Z" /></svg>
                </span>
              </div>
            </>
          )}
          {sheet !== null && p.turns[sheet]?.list ? (
            <ListSheet list={p.turns[sheet]!.list!} send={p.chrome.send} closeLabel={t("closeList")} canSend={p.tapOn === sheet}
              onClose={() => setSheet(null)} onSend={(title) => { const at = sheet; setSheet(null); p.onList?.(at, title); }} returnTo={chat} />
          ) : null}
        </div>
      </div>
    </figure>
  );
}

function Turn({ turn, index, first, p, text, onOpenList }: { turn: PhoneTurn; index: number; first: boolean; p: WhatsAppPhoneProps; text?: string; onOpenList(): void }) {
  const t = useTranslations("whatsappPhone");
  const locale = useLocale();
  const out = turn.from === "customer";
  const live = p.tapOn === index;
  const editable = turn.editable && turn.key && p.onEdit;
  const active = Boolean(turn.key && p.activeKey === turn.key);
  const issue = Boolean(turn.key && p.issueKeys?.has(turn.key));
  const bubble = cx(s.bubble, out ? s.bubbleOut : s.bubbleIn, first && (out ? s.tailOut : s.tailIn), active && s.active, issue && s.issue,
    (turn.kind === "buttons" || turn.kind === "template") && s.bubbleWide, s.enter);

  if (out) {
    return (
      <li className={cx(s.row, s.rowOut, first && s.rowFirst)}>
        <div className={bubble}>
          <div className={s.content}>
            <span className={s.body} dir="auto">{text ?? turn.text}<MetaSpace out /></span>
            <Meta out />
          </div>
        </div>
      </li>
    );
  }

  const content: ReactNode = (
    <>
      {turn.header ? <span className={s.head} dir="auto"><WaText text={turn.header} /></span> : null}
      <span className={s.body} dir="auto"><WaText text={turn.body ?? turn.text ?? ""} />{turn.footer ? null : <MetaSpace out={false} />}</span>
      {turn.footer ? <span className={s.foot} dir="auto">{turn.footer}<MetaSpace out={false} /></span> : null}
    </>
  );
  // Mizan's own words inside the buyer's chat: in the dashboard's language, not the chat's.
  const ui = { lang: locale, dir: locale === "ar" ? "rtl" : "ltr" } as const;
  const buttons = turn.kind === "template" || turn.kind === "buttons" ? turn.buttons ?? [] : [];
  return (
    <li className={cx(s.row, s.rowIn, first && s.rowFirst)}>
      <div className={bubble} data-key={turn.key}>
        {turn.kind === "template" ? (
          <Tooltip content={<span {...ui}>{t("templateTip")}</span>}>
            <span tabIndex={0} className={s.templateTag} {...ui}><Icon name="locked" size={12} />{t("template")}</span>
          </Tooltip>
        ) : null}
        <div className={s.content}>
          {editable ? (
            <button type="button" className={s.bubbleBtn} aria-label={t("edit", { text: (turn.body ?? turn.text ?? "").slice(0, 60) })} aria-pressed={active}
              onClick={() => p.onEdit!(turn.key!)}>{content}</button>
          ) : <div>{content}</div>}
          <Meta out={false} />
        </div>
        {turn.kind === "list" && turn.list ? (
          <>
            <div className={s.divider} />
            <button type="button" className={s.listBtn} onClick={onOpenList} aria-haspopup="dialog">
              <Icon name="menu" size={16} />{turn.list.button}
            </button>
          </>
        ) : null}
      </div>
      {buttons.length ? (
        <div className={s.buttons}>
          {buttons.map((b, j) => {
            const can = turn.kind === "template" ? Boolean(p.onTemplate) : live && Boolean(p.onButton);
            return (
              <button key={j} type="button" disabled={!can} className={cx(s.waButton, turn.kind === "template" && p.pulse && s.pulse)}
                onClick={() => (turn.kind === "template" ? p.onTemplate?.(j) : p.onButton?.(index, j))}>
                <ReplyArrow /><span dir="auto">{b}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {turn.kind === "template" && p.pulse ? <p className={s.hint} {...ui}>{t("tapHint")}</p> : null}
    </li>
  );
}

/** Quick sample replies over the composer: a menu, Esc closes and returns focus. */
function Replies({ replies, label, onClose, onPick }: { replies: readonly PhoneReply[]; label: string; onClose(): void; onPick(id: string): void }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (e: PointerEvent) => { if (!box.current?.parentElement?.contains(e.target as Node)) close.current(); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const onKey = (e: ReactKeyboardEvent) => {
    const items = [...(box.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") { e.preventDefault(); onClose(); (box.current?.nextElementSibling as HTMLElement | null)?.focus(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(at + 1) % items.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(at - 1 + items.length) % items.length]?.focus(); }
  };
  return (
    <div ref={box} role="menu" aria-label={label} className={s.replies} onKeyDown={onKey}>
      {replies.map((r) => (
        <button key={r.id} type="button" role="menuitem" className={s.reply} onClick={() => onPick(r.id)}>
          <Icon name="send" size={14} />
          <span className="flex min-w-0 flex-col"><span dir="auto">{r.label}</span>{r.hint ? <small dir="auto">{r.hint}</small> : null}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The list's bottom sheet, inside the phone, like WhatsApp's: the chat dims, rows with a radio,
 * Send. A modal for assistive tech: focus stays inside, Esc closes, focus goes back to the list button.
 */
function ListSheet({ list, send, closeLabel, canSend, onClose, onSend, returnTo }: {
  list: NonNullable<PhoneTurn["list"]>; send: string; closeLabel: string; canSend: boolean; onClose(): void; onSend(title: string): void; returnTo: React.RefObject<HTMLDivElement | null>;
}) {
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLElement>("[role=radio][tabindex='0']")?.focus();
    const back = opener.current;
    const fallback = returnTo.current;
    return () => { (back && back.isConnected ? back : fallback)?.focus?.(); };
  }, [returnTo]);
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key !== "Tab") return;
    const items = [...(ref.current?.querySelectorAll<HTMLElement>("button:not([disabled]):not([tabindex='-1'])") ?? [])];
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  // A radio group: one tab stop (the chosen row, or the first), the arrow keys move and choose.
  const current = picked ?? 0;
  const onRowKey = (e: ReactKeyboardEvent<HTMLButtonElement>, i: number) => {
    const n = list.rows.length;
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const next = e.key === "ArrowDown" || e.key === (rtl ? "ArrowLeft" : "ArrowRight") ? (i + 1) % n
      : e.key === "ArrowUp" || e.key === (rtl ? "ArrowRight" : "ArrowLeft") ? (i - 1 + n) % n
        : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (next === null) return;
    e.preventDefault();
    setPicked(next);
    ref.current?.querySelectorAll<HTMLElement>("[role=radio]")[next]?.focus();
  };
  return (
    <>
      <div className={s.dim} onClick={onClose} aria-hidden="true" />
      <div ref={ref} className={s.sheet} role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} onKeyDown={onKey} data-testid="list-sheet">
        <span className={s.handle} aria-hidden="true" />
        <div className={s.sheetHead}>
          <button type="button" className={s.sheetClose} aria-label={closeLabel} onClick={onClose}><Icon name="close" size={20} /></button>
          <span id={`${id}-t`} className={s.sheetTitle} dir="auto">{list.button}</span>
          <span />
        </div>
        {list.section ? <div className={s.sheetSection} dir="auto">{list.section}</div> : null}
        <ul className={s.sheetRows} role="radiogroup" aria-labelledby={`${id}-t`}>
          {list.rows.map((r, i) => (
            <li key={i}>
              <button type="button" role="radio" aria-checked={picked === i} tabIndex={i === current ? 0 : -1} className={s.sheetRow}
                onClick={() => setPicked(i)} onKeyDown={(e) => onRowKey(e, i)}>
                <span className={s.rowText}>
                  <span className={s.rowTitle} dir="auto">{r.title}</span>
                  {r.description ? <span className={s.rowDesc} dir="auto">{r.description}</span> : null}
                </span>
                <span className={cx(s.radio, picked === i && s.radioOn)} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <div className={s.sheetFoot}>
          <button type="button" className={s.sheetSend} disabled={picked === null || !canSend} onClick={() => picked !== null && onSend(list.rows[picked]!.title)}>{send}</button>
        </div>
      </div>
    </>
  );
}

/** The team's call script, drawn as the call screen the team member holds. */
function CallSheet({ lines, name, sub, label }: { lines: readonly string[]; name: string; sub: string; label: string }) {
  return (
    <div className={s.call} data-testid="call-sheet">
      <div className={s.callTop}>
        <Avatar name={name} className={s.callAvatar} />
        <span className={s.callName}>{name}</span>
        <span className={s.callSub}>{sub}</span>
      </div>
      <ol className={s.callLines} aria-label={label}>
        {lines.map((l, i) => <li key={i}><span dir="auto"><WaText text={l} /></span></li>)}
      </ol>
      <div className={s.callActions} aria-hidden="true">
        <span className={s.callBtn}><Icon name="hidden" size={20} /></span>
        <span className={s.callBtn}><Icon name="more" size={20} /></span>
        <span className={cx(s.callBtn, s.callEnd)}><Icon name="call" size={20} /></span>
      </div>
    </div>
  );
}
