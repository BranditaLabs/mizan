"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { cx, matches, moveIndex } from "./logic";

export interface ComboOption { value: string; label: string; hint?: ReactNode }

/**
 * Combobox (ARIA 1.2 list autocomplete): type to filter, arrows move, Enter picks, Esc closes.
 * For long lists (cities, couriers, products); short lists use Select. Arabic search folds
 * أ/إ/آ → ا, ة → ه, ى → ي and Arabic-Indic digits, so "اسكندرية" finds "الإسكندرية".
 */
export function Combobox({ label, options, value, onChange, placeholder, emptyText, hint, error, className }: {
  label: string; options: readonly ComboOption[]; value: string | null; onChange(v: string): void;
  placeholder?: string; emptyText: string; hint?: ReactNode; error?: string | null; className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null); // null = showing the chosen value
  const [active, setActive] = useState(0);
  const chosen = options.find((o) => o.value === value);
  const shown = useMemo(() => (query ? options.filter((o) => matches(o.label, query)) : options), [options, query]);
  const pick = (o: ComboOption) => { onChange(o.value); setQuery(null); setOpen(false); };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); setActive(0); return; }
    if (e.key === "Escape") { if (open) { e.preventDefault(); setOpen(false); } else setQuery(null); return; }
    if (e.key === "Enter" && open && shown[active]) { e.preventDefault(); pick(shown[active]); return; }
    if (!open) return;
    const next = moveIndex(e.key === "Home" || e.key === "End" ? "" : e.key, active, shown.length, { orientation: "vertical" });
    if (next !== null) { e.preventDefault(); setActive(next); }
  };

  const note = error || hint ? `${id}-note` : undefined;
  return (
    <div className={cx("mz-field relative", className)}>
      <label htmlFor={id} className="mz-label">{label}</label>
      <div className="relative flex items-center">
        <input id={id} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `${id}-opt-${active}` : undefined} aria-invalid={error ? true : undefined} aria-describedby={note}
          autoComplete="off" placeholder={placeholder} className="mz-input pe-8"
          value={query ?? chosen?.label ?? ""}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)} onBlur={() => { setOpen(false); setQuery(null); }} onKeyDown={onKey} />
        <Icon name="chevron-down" size={16} className="pointer-events-none absolute end-2.5 text-text-3" />
      </div>
      {open ? (
        <ul id={`${id}-list`} role="listbox" aria-label={label}
          className="mz-menu mz-enter absolute inset-x-0 top-full z-[var(--mz-z-dropdown)] mt-1 max-h-64 overflow-y-auto">
          {shown.length === 0 ? <li className="px-2.5 py-2 text-body-sm text-text-3">{emptyText}</li> : null}
          {shown.map((o, i) => (
            <li key={o.value} id={`${id}-opt-${i}`} role="option" aria-selected={o.value === value}
              className={cx("mz-menu__item justify-between", i === active && "bg-surface-hover")}
              onPointerDown={(e) => e.preventDefault()} onPointerEnter={() => setActive(i)} onClick={() => pick(o)}>
              <span>{o.label}</span>
              {o.value === value ? <Icon name="confirm" size={14} /> : o.hint ? <span className="text-caption text-text-3">{o.hint}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p id={note} role="alert" className="mz-error-text"><Icon name="error" size={14} />{error}</p> : hint ? <p id={note} className="mz-hint">{hint}</p> : null}
    </div>
  );
}
