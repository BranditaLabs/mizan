/**
 * CSV for spreadsheets (Excel, Google Sheets, Numbers): UTF-8 with a byte-order mark so Arabic
 * opens correctly, CRLF lines, fields quoted when they hold a comma, quote or line break, and
 * cells that would start a formula (= + - @) prefixed with ' so a label can never run as one.
 * Amounts are passed as decimal strings ("1150.00"), never formatted, so sums work.
 */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<string | number | null>>): string {
  const cell = (v: string | number | null) => {
    if (v === null) return "";
    if (typeof v === "number") return String(v);
    const safe = /^[=+@\t\r]/.test(v) || (/^-/.test(v) && !/^-\d+(\.\d+)?$/.test(v)) ? `'${v}` : v;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return `﻿${rows.map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}

/** Hands the browser a file to save. */
export function downloadText(name: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
