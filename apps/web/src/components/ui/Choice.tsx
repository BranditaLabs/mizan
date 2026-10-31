"use client";

import { useLocale } from "next-intl";
import { useLayoutEffect, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { cx, moveIndex } from "./logic";

/** Checkbox (16px, ink when checked) with its label (components.md §3). `indeterminate` for "some rows". */
export function Checkbox({ label, indeterminate, className, ...input }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode; indeterminate?: boolean }) {
  return (
    <label className={cx("mz-check", className)}>
      <input type="checkbox" ref={(el) => { if (el) el.indeterminate = Boolean(indeterminate); }} {...input} />
      {label}
    </label>
  );
}

/** A checkbox without a visible label (table rows): the label is for screen readers. */
export function CheckboxOnly({ label, indeterminate, ...input }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string; indeterminate?: boolean }) {
  return (
    <span className="mz-check">
      <input type="checkbox" aria-label={label} ref={(el) => { if (el) el.indeterminate = Boolean(indeterminate); }} {...input} />
    </span>
  );
}

/** Switch 34×20, ink when on: for settings that apply at once (not for form submits). */
export function Switch({ label, description, className, ...input }: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role"> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className={cx("mz-check items-start justify-between gap-4", className)}>
      <span className="flex flex-col gap-0.5">
        <span className="text-label">{label}</span>
        {description ? <span className="mz-hint">{description}</span> : null}
      </span>
      <input type="checkbox" role="switch" className="mz-switch shrink-0" {...input} />
    </label>
  );
}

/**
 * Segmented control (`.mz-segmented`): 2–4 exclusive views. A radio group for assistive tech;
 * arrow keys move the choice (and follow the screen in right-to-left).
 */
/**
 * The thumb under a segmented control's chosen option (Mizan Glass "seg-thumb"): it springs to the
 * option when the choice changes and follows it when sizes or the language change. Place it as the
 * group's first child; `index` is the chosen option's position among the buttons.
 */
export function SegThumb({ index }: { index: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [box, setBox] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const thumb = ref.current;
    const group = thumb?.parentElement;
    if (!thumb || !group) return;
    const measure = () => {
      const b = group.querySelectorAll<HTMLElement>(":scope > button")[index];
      setBox(b ? { x: b.offsetLeft, w: b.offsetWidth } : null);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(group);
    return () => ro.disconnect();
  }, [index]);
  return <span ref={ref} className="mz-seg-thumb" aria-hidden="true" style={box ? { width: box.w, transform: `translateX(${box.x}px)` } : { opacity: 0 }} />;
}

export function Segmented<V extends string>({ label, value, options, onChange, className }:
  { label: string; value: V; options: ReadonlyArray<{ value: NoInfer<V>; label: ReactNode; lang?: string }>; onChange(v: NoInfer<V>): void; className?: string }) {
  const rtl = useLocale() === "ar";
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = options.findIndex((o) => o.value === value);
  const onKey = (e: KeyboardEvent) => {
    const next = moveIndex(e.key, current, options.length, { rtl });
    if (next === null) return;
    e.preventDefault();
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cx("mz-segmented", className)} onKeyDown={onKey}>
      {current >= 0 ? <SegThumb index={current} /> : null}
      {options.map((o, i) => (
        <button key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" lang={o.lang}
          aria-checked={o.value === value} tabIndex={o.value === value ? 0 : -1}
          className="inline-flex items-center gap-1.5" onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
