import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import { MizanLoader } from "@mizan/design-system/react/motion";
import type { ReactNode } from "react";
import { cx, initials } from "./logic";

/** Card (`.mz-card`): flat, 1px line, radius 8. Optional head with title and actions. */
export function Card({ title, actions, children, className, bodyClassName }:
  { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cx("mz-card", className)}>
      {title || actions ? (
        <header className="mz-card__head">
          {title ? <h2 className="mz-card__title">{title}</h2> : <span />}
          {actions}
        </header>
      ) : null}
      <div className={cx("mz-card__body", bodyClassName)}>{children}</div>
    </section>
  );
}

/** Key-value list for side panels (`.mz-kv`, 120px label column). */
export function KeyValue({ items, className }: { items: ReadonlyArray<{ label: ReactNode; value: ReactNode }>; className?: string }) {
  return (
    <dl className={cx("mz-kv", className)}>
      {items.map((it, i) => (
        <div key={i} className="contents">
          <dt>{it.label}</dt>
          <dd>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Empty state (components.md §6): 24px icon, one-line title, one sentence, one action. */
export function EmptyState({ icon, title, body, action }: { icon: IconProps["name"]; title: ReactNode; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="mz-empty">
      <Icon name={icon} size={24} />
      <h3 className="text-text">{title}</h3>
      <p className="max-w-[48ch] text-body-sm">{body}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Skeleton shaped like the content (never a spinner for a whole page). Hidden from assistive tech. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cx("mz-skeleton block", className)} />;
}

/**
 * Skeleton rows for a table or list while it loads; announces "loading" once. Brand 2.0: the rows
 * are a still 6% ink (no shimmer), and a 20 px pair loader in the head says it is loading.
 */
export function SkeletonRows({ rows = 5, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="flex flex-col gap-3 p-4" data-testid="page-state">
      <span className="text-text-3"><MizanLoader kind="pair" size={20} decorative /></span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

/**
 * Known progress (Brand 2.0 "fill"), 0–100: the fluid bar fills from where it was, the red bubble
 * rides the meniscus and leaves at the end. Keeps progressbar semantics (label, value, value text);
 * reduced motion shows the still width with its value as text. `width` in px (the bar's height
 * follows its aspect).
 */
export function FillProgress({ value, label, valueText, width = 160, className }: { value: number; label: string; valueText?: string; width?: number; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <span className={cx("inline-flex text-text", className)} data-testid="progress-bar">
      <MizanLoader kind="fill" value={v / 100} size={width} label={label} valueText={valueText ?? `${Math.round(v)}%`} />
    </span>
  );
}

/** The old name (one release): every progress bar is the fill loader now. */
export const Progress = FillProgress;

/** Avatar with initials (no photos of customers). The name is the accessible label. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return <span role="img" aria-label={name} className={cx("mz-avatar", className)}>{initials(name)}</span>;
}

/**
 * Timeline (`.mz-timeline`): newest first. A row's `glyph` (its catalogue outcome, an EventGlyph)
 * takes the place of the dot; rows without one keep a quiet dot (never red: the view's one red
 * belongs to the content).
 */
export function Timeline({ items, label }: { items: ReadonlyArray<{ id: string; title: ReactNode; time: ReactNode; detail?: ReactNode; glyph?: ReactNode }>; label: string }) {
  return (
    <ol aria-label={label} className="mz-timeline">
      {items.map((it) => (
        <li key={it.id} className={cx("mz-timeline__item", it.glyph != null && "mz-timeline__item--glyph")}>
          {it.glyph != null ? <span className="mz-timeline__glyph" aria-hidden="true">{it.glyph}</span> : null}
          <div>
            <p className="font-medium">{it.title}</p>
            {it.detail ? <p className="text-caption text-text-2">{it.detail}</p> : null}
            {it.time}
          </div>
        </li>
      ))}
    </ol>
  );
}
