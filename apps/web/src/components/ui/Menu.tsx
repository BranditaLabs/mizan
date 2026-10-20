"use client";

import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import { useLocale } from "next-intl";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { buttonClass, type ButtonVariant } from "./Button";
import { cx, moveIndex } from "./logic";

export interface MenuItem { id: string; label: ReactNode; icon?: IconProps["name"]; danger?: boolean; separatorBefore?: boolean; onSelect(): void }

/**
 * Menu button (components.md §7, `.mz-menu`): rare actions behind "more". Arrow keys move, Enter or
 * Space picks, Esc closes and returns focus, Tab or a click outside closes. Opens at the inline end.
 */
export function MenuButton({ label, icon = "more", text, items, variant = "ghost" }:
  { label: string; icon?: IconProps["name"]; text?: ReactNode; items: readonly MenuItem[]; variant?: ButtonVariant }) {
  const rtl = useLocale() === "ar";
  const id = useId();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const outside = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const onMenuKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(true); return; }
    if (e.key === "Tab") { close(false); return; }
    const at = itemRefs.current.findIndex((el) => el === document.activeElement);
    const next = moveIndex(e.key, at, items.length, { orientation: "vertical", rtl });
    if (next !== null) { e.preventDefault(); itemRefs.current[next]?.focus(); }
  };

  return (
    <div ref={box} className="relative inline-block">
      <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? `${id}-menu` : undefined}
        aria-label={text ? undefined : label} title={text ? undefined : label}
        className={buttonClass(variant, "md", text ? undefined : "mz-btn--icon")}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); } }}>
        <Icon name={icon} size={16} />
        {text}
      </button>
      {open ? (
        <div id={`${id}-menu`} role="menu" aria-label={label} onKeyDown={onMenuKey}
          className="mz-menu mz-enter absolute end-0 top-full z-[var(--mz-z-dropdown)] mt-1">
          {items.map((it, i) => (
            <div key={it.id}>
              {it.separatorBefore ? <div role="separator" className="mz-menu__sep" /> : null}
              <button ref={(el) => { itemRefs.current[i] = el; }} type="button" role="menuitem" tabIndex={-1}
                className={cx("mz-menu__item w-full text-start", it.danger && "mz-menu__item--danger")}
                onClick={() => { close(true); it.onSelect(); }}>
                {it.icon ? <Icon name={it.icon} size={16} /> : null}
                {it.label}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
