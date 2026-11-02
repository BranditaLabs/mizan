import { toAsciiDigits } from "@mizan/shared";

/**
 * Reading the CSV files merchants upload (ad spend, product costs): a sheet's export or a
 * platform's report. Commas or semicolons (whichever the header uses more), double quotes around
 * fields that contain either, a UTF-8 BOM, CRLF or LF, blank lines ignored. Line numbers are the
 * file's own, so an error can name the line the merchant sees in their sheet.
 */
export interface CsvLine { line: number; fields: string[] }

export function readCsv(text: string): { header: CsvLine; rows: CsvLine[] } | null {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  const headerAt = lines.findIndex((l) => l.trim() !== "");
  if (headerAt < 0) return null;
  const head = lines[headerAt]!;
  const sep = (head.match(/;/g)?.length ?? 0) > (head.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: CsvLine[] = [];
  for (let i = headerAt + 1; i < lines.length; i++) if (lines[i]!.trim() !== "") rows.push({ line: i + 1, fields: fields(lines[i]!, sep) });
  return { header: { line: headerAt + 1, fields: fields(head, sep) }, rows };
}

/** A header cell as a lookup key: lower case, single spaces. */
export const headerKey = (h: string) => h.toLowerCase().replace(/\s+/g, " ").trim();

/** "1,234.50", "1234.5", "١٢٣٤٫٥" → "1234.50"-style plain decimal, or null. */
export function plainDecimal(v: string): string | null {
  const western = toAsciiDigits(v).replace(/٫/g, ".").replace(/[٬,\s]/g, "");
  return /^\d{1,12}(\.\d{1,3})?$/.test(western) ? western : null;
}

function fields(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') quoted = false; else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { out.push(cur); cur = ""; } else cur += c;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}
