import type { ReactNode } from "react";

/** Segmented control (docs/components.md §3): 2–4 exclusive choices. */
export function Segmented({ label, children }: { label: string; children: ReactNode }) {
  return <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-md border border-line bg-surface p-0.5">{children}</div>;
}

export function SegmentButton({ pressed, children, ...rest }: { pressed: boolean; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" aria-pressed={pressed}
      className={`inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-label transition-colors duration-150 ease-standard ${pressed ? "bg-primary text-on-primary" : "text-text-2 hover:bg-surface-hover hover:text-text"}`}
      {...rest}>
      {children}
    </button>
  );
}
