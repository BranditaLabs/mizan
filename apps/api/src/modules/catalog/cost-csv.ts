import { toAsciiDigits } from "@mizan/shared";
import { headerKey, plainDecimal, readCsv } from "../../platform/csv.js";

/**
 * The product costs file (E8-1): one row per SKU with its cost and, optionally, its barcode.
 * Mizan's own "download list" file reads back as is, and so does Shopify's product export
 * ("Variant SKU", "Cost per item", "Variant Barcode"). Other columns are ignored. An empty cost or
 * barcode cell leaves that field as it is; a row with neither is skipped. All or nothing: any bad
 * line is reported with its number and nothing is saved.
 */
const HEADERS: Record<string, "sku" | "cost" | "barcode"> = {
  sku: "sku", "variant sku": "sku", "رمز المنتج": "sku", "كود المنتج": "sku", "الكود": "sku", "sku code": "sku",
  cost: "cost", "unit cost": "cost", cogs: "cost", "cost per item": "cost", "product cost": "cost", "التكلفة": "cost", "تكلفة": "cost", "سعر التكلفة": "cost", "تكلفة المنتج": "cost",
  barcode: "barcode", "variant barcode": "barcode", ean: "barcode", upc: "barcode", gtin: "barcode", "الباركود": "barcode", "باركود": "barcode",
};

export const MAX_COST_ROWS = 5000;
export const BARCODE = /^[\x21-\x7E]{1,64}$/;

export interface CostRow { line: number; sku: string; cost?: string; barcode?: string }
export interface CostCsvProblem {
  line: number;
  problem: "header" | "columns" | "sku" | "cost" | "barcode" | "duplicate" | "too_many" | "empty" | "unknown_sku" | "barcode_taken";
  value?: string;
}

/** A cell our own download protected from spreadsheets ('=…) reads back as typed. */
const unprotect = (v: string) => (/^'[=+@\-\t]/.test(v) ? v.slice(1) : v);

export function parseCostCsv(text: string): { rows: CostRow[]; skipped: number; problems: CostCsvProblem[] } {
  const csv = readCsv(text);
  if (!csv) return { rows: [], skipped: 0, problems: [{ line: 1, problem: "empty" }] };
  const cols = csv.header.fields.map((h) => HEADERS[headerKey(h)]);
  const at = (k: "sku" | "cost" | "barcode") => cols.indexOf(k);
  if (at("sku") < 0 || (at("cost") < 0 && at("barcode") < 0)) return { rows: [], skipped: 0, problems: [{ line: csv.header.line, problem: "header" }] };

  const rows: CostRow[] = [];
  const problems: CostCsvProblem[] = [];
  const seenSku = new Map<string, number>();
  const seenBarcode = new Map<string, number>();
  let skipped = 0;
  for (const { line, fields: f } of csv.rows) {
    if (rows.length + problems.length + skipped >= MAX_COST_ROWS) { problems.push({ line, problem: "too_many" }); break; }
    if (f.length <= at("sku")) { problems.push({ line, problem: "columns" }); continue; }
    const sku = unprotect(f[at("sku")] ?? "");
    const costCell = at("cost") >= 0 ? (f[at("cost")] ?? "") : "";
    const barcodeCell = at("barcode") >= 0 ? toAsciiDigits(unprotect(f[at("barcode")] ?? "")) : "";
    if (!costCell && !barcodeCell) { skipped++; continue; }
    if (!sku) { problems.push({ line, problem: "sku" }); continue; }
    if (seenSku.has(sku)) { problems.push({ line, problem: "duplicate", value: sku }); continue; }
    const cost = costCell ? plainDecimal(costCell) : undefined;
    if (cost === null) { problems.push({ line, problem: "cost", value: costCell }); continue; }
    if (barcodeCell && !BARCODE.test(barcodeCell)) { problems.push({ line, problem: "barcode", value: barcodeCell }); continue; }
    if (barcodeCell && seenBarcode.has(barcodeCell)) { problems.push({ line, problem: "barcode_taken", value: barcodeCell }); continue; }
    seenSku.set(sku, line);
    if (barcodeCell) seenBarcode.set(barcodeCell, line);
    rows.push({ line, sku, ...(cost !== undefined ? { cost } : {}), ...(barcodeCell ? { barcode: barcodeCell } : {}) });
  }
  if (!rows.length && !problems.length) problems.push({ line: csv.header.line + 1, problem: "empty" });
  return { rows, skipped, problems };
}
