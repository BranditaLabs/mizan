"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, type ReactNode } from "react";
import { Bdi } from "../Bdi";
import { Button } from "./Button";
import { CheckboxOnly } from "./Choice";
import { cx, sortRows, type SortDir, type SortValue } from "./logic";

export interface Column<T> {
  id: string;
  header: string;
  cell(row: T): ReactNode;
  /** Numbers and money: end-aligned, tabular. */
  numeric?: boolean;
  /** Present = sortable by this value (numbers, dates, or text sorted in the page's language). */
  sortValue?(row: T): SortValue;
  className?: string;
}

/**
 * Data table (components.md §5, `.mz-table`): sticky header, 44px rows, numbers end-aligned, sortable
 * columns (`aria-sort`), optional row selection with a bulk bar that replaces the title-row actions.
 * Scrolls inside its container on phones. `label` names the table for screen readers.
 */
export function DataTable<T>({ label, columns, rows, rowKey, rowLabel, selectable = false, selected: selectedProp, onSelectedChange, bulkActions,
  defaultSort, empty, className }: {
  label: string;
  columns: ReadonlyArray<Column<T>>;
  rows: readonly T[];
  rowKey(row: T): string;
  /** How a row is named to screen readers ("Order #1042"), for its checkbox. */
  rowLabel?(row: T): string;
  selectable?: boolean;
  selected?: ReadonlySet<string>;
  onSelectedChange?(keys: Set<string>): void;
  bulkActions?(keys: ReadonlySet<string>, clear: () => void): ReactNode;
  defaultSort?: { id: string; dir: SortDir };
  empty?: ReactNode;
  className?: string;
}) {
  const t = useTranslations("ui.table");
  const locale = useLocale();
  const [sort, setSort] = useState(defaultSort ?? null);
  const [own, setOwn] = useState<Set<string>>(() => new Set());
  const selected = selectedProp ?? own;
  const setSelected = (keys: Set<string>) => (onSelectedChange ? onSelectedChange(keys) : setOwn(keys));

  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.id === sort.id);
    return sort && col?.sortValue ? sortRows(rows, col.sortValue, sort.dir, locale) : [...rows];
  }, [rows, columns, sort, locale]);

  const keys = sorted.map(rowKey);
  const chosen = keys.filter((k) => selected.has(k)).length;
  const toggleAll = () => setSelected(chosen === keys.length ? new Set() : new Set(keys));
  const toggle = (k: string) => {
    const next = new Set(selected);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setSelected(next);
  };
  const clear = () => setSelected(new Set());
  const nextSort = (id: string) =>
    setSort((s) => (s?.id !== id ? { id, dir: "asc" } : s.dir === "asc" ? { id, dir: "desc" } : null));

  return (
    <div className={cx("flex flex-col gap-3", className)}>
      {selectable && chosen > 0 ? (
        <div role="region" aria-label={t("bulk")} className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-selected px-3 py-2">
          <span className="text-label" aria-live="polite">{t("selected", { count: chosen })}</span>
          <span className="flex-1" />
          {bulkActions?.(selected, clear)}
          <Button variant="ghost" size="sm" onClick={clear}>{t("clear")}</Button>
        </div>
      ) : null}
      <div className="mz-table-wrap max-h-[70dvh]">
        <table className="mz-table">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr>
              {selectable ? (
                <th scope="col" className="w-10">
                  <CheckboxOnly label={t("selectAll")} checked={keys.length > 0 && chosen === keys.length} indeterminate={chosen > 0 && chosen < keys.length}
                    onChange={toggleAll} disabled={keys.length === 0} />
                </th>
              ) : null}
              {columns.map((c) => {
                const dir = sort?.id === c.id ? sort.dir : null;
                return (
                  <th key={c.id} scope="col" className={cx(c.numeric && "mz-num", c.className)}
                    aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : c.sortValue ? "none" : undefined}>
                    {c.sortValue ? (
                      <button type="button" onClick={() => nextSort(c.id)} className="inline-flex items-center gap-1 hover:text-text">
                        {c.header}
                        <Icon name={dir === "desc" ? "arrow-down" : "arrow-up"} size={12} className={dir ? "opacity-100" : "opacity-30"} />
                      </button>
                    ) : c.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (selectable ? 1 : 0)} className="whitespace-normal">{empty}</td>
              </tr>
            ) : sorted.map((row) => {
              const k = rowKey(row);
              const on = selected.has(k);
              return (
                <tr key={k} aria-selected={selectable ? on : undefined}>
                  {selectable ? (
                    <td><CheckboxOnly label={t("selectRow", { row: rowLabel?.(row) ?? k })} checked={on} onChange={() => toggle(k)} /></td>
                  ) : null}
                  {columns.map((c) => <td key={c.id} className={cx(c.numeric && "mz-num", c.className)}>{c.cell(row)}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sorted.length > 0 ? <p className="sr-only" aria-live="polite">{t("count", { count: sorted.length })}</p> : null}
    </div>
  );
}

/** A cell with a main line and a secondary line (`sub`, 12px text-3). */
export function Cell({ main, sub }: { main: ReactNode; sub?: ReactNode }) {
  return (
    <>
      {main}
      {sub ? <span className="sub">{sub}</span> : null}
    </>
  );
}

/** An order id, SKU or tracking number in a cell (`mz-id`, left to right). */
export function IdCell({ children }: { children: ReactNode }) {
  return <Bdi code>{children}</Bdi>;
}
