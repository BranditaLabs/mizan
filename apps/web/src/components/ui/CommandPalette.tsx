"use client";

import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useMemo, useState, type KeyboardEvent } from "react";
import { useModal } from "./Dialog";
import { cx, matches, moveIndex } from "./logic";

const ESC = "Esc";

export interface Command { id: string; label: string; group: string; icon?: IconProps["name"]; keywords?: string; run(): void }

/** ⌘K on Mac, Ctrl+K elsewhere. */
export function isPaletteShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean }): boolean {
  return (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
}

/**
 * Command palette (components.md §10: "⌘K command palette"): jump to a page or run an action by
 * typing. A modal dialog with a combobox and a grouped listbox; Esc closes and returns focus.
 * The caller owns `open` and listens for the shortcut (see useCommandPalette).
 */
export function CommandPalette({ open, onClose, commands }: { open: boolean; onClose(): void; commands: readonly Command[] }) {
  const t = useTranslations("ui.palette");
  const id = useId();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const shown = useMemo(() => commands.filter((c) => matches(`${c.label} ${c.group} ${c.keywords ?? ""}`, query)), [commands, query]);

  const close = () => { setQuery(""); setActive(0); onClose(); };
  const modal = useModal(open, close);
  const run = (c: Command) => { close(); c.run(); };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" && shown[active]) { e.preventDefault(); run(shown[active]); return; }
    const next = moveIndex(e.key === "Home" || e.key === "End" ? "" : e.key, active, shown.length, { orientation: "vertical" });
    if (next !== null) { e.preventDefault(); setActive(next); }
  };

  return (
    <dialog {...modal} aria-label={t("label")}
      className={cx("mz-dialog mz-enter mx-auto mt-[12dvh] mb-auto w-[min(560px,calc(100vw-32px))] gap-0 p-0 text-text backdrop:bg-scrim", !open && "hidden")}>
      {open ? (
        <>
          <div className="flex items-center gap-2.5 border-b border-line px-4">
            <Icon name="search" size={16} className="text-text-3" />
            <input role="combobox" aria-expanded aria-controls={`${id}-list`} aria-autocomplete="list" data-autofocus
              aria-activedescendant={shown[active] ? `${id}-${shown[active].id}` : undefined} aria-label={t("label")}
              placeholder={t("placeholder")} className="h-12 flex-1 bg-transparent text-body outline-none placeholder:text-text-3"
              value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }} onKeyDown={onKey} />
            <kbd className="mz-kbd" dir="ltr">{ESC}</kbd>
          </div>
          <ul id={`${id}-list`} role="listbox" aria-label={t("results")} className="max-h-[50dvh] overflow-y-auto p-1">
            {shown.length === 0 ? <li className="px-3 py-6 text-center text-body-sm text-text-3">{t("empty")}</li> : null}
            {shown.map((c, i) => {
              const header = i === 0 || shown[i - 1]!.group !== c.group ? c.group : null;
              return (
                <li key={c.id} role="presentation">
                  {header ? <p role="presentation" className="px-2.5 pt-2.5 pb-1 text-caption text-text-3">{header}</p> : null}
                  <div id={`${id}-${c.id}`} role="option" aria-selected={i === active}
                    className={cx("mz-menu__item", i === active && "bg-surface-hover")}
                    onPointerEnter={() => setActive(i)} onClick={() => run(c)}>
                    {c.icon ? <Icon name={c.icon} size={16} className="text-text-2" /> : null}
                    {c.label}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </dialog>
  );
}

/** Open state for the palette, with the global ⌘K / Ctrl+K shortcut. */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (isPaletteShortcut(e)) { e.preventDefault(); setOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return { open, setOpen };
}
