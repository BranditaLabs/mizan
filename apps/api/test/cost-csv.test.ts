import { describe, expect, it } from "vitest";
import { parseCostCsv } from "../src/modules/catalog/cost-csv.js";

describe("product costs CSV (E8-1)", () => {
  it("reads Mizan's own list back, extra columns ignored, empty cells left alone", () => {
    const csv = "﻿Product,Variant,SKU,Barcode,Price,Cost\r\nAbaya,Black,ABY-BLK,6221234567890,1150.00,420\r\nAbaya,Grey,ABY-GRY,,1150.00,\r\nScarf,,SCF-1,,150.00,\"1,050.5\"\r\n";
    const r = parseCostCsv(csv);
    expect(r.problems).toEqual([]);
    expect(r.rows).toEqual([
      { line: 2, sku: "ABY-BLK", cost: "420", barcode: "6221234567890" },
      { line: 4, sku: "SCF-1", cost: "1050.5" },
    ]);
    expect(r.skipped).toBe(1);
  });

  it("reads Shopify's product export and Arabic headers and digits", () => {
    expect(parseCostCsv("Handle,Variant SKU,Cost per item,Variant Barcode\nabaya,ABY-1,300.00,\n").rows).toEqual([{ line: 2, sku: "ABY-1", cost: "300.00" }]);
    expect(parseCostCsv("رمز المنتج;التكلفة;الباركود\nABY-1;٣٢٠٫٥;٦٢٢١٢٣\n").rows).toEqual([{ line: 2, sku: "ABY-1", cost: "320.5", barcode: "622123" }]);
  });

  it("a SKU protected from spreadsheets reads back as typed", () => {
    expect(parseCostCsv("sku,cost\n'-ABY,10\n").rows[0]).toMatchObject({ sku: "-ABY" });
  });

  it("names every bad line and keeps nothing", () => {
    const r = parseCostCsv("sku,cost,barcode\nA,abc,\nA2,10,\nA2,11,\n,5,\nB,5,with space\nC,5,622\nD,6,622\n");
    expect(r.rows.length).toBe(2);
    expect(r.problems).toEqual([
      { line: 2, problem: "cost", value: "abc" },
      { line: 4, problem: "duplicate", value: "A2" },
      { line: 5, problem: "sku" },
      { line: 6, problem: "barcode", value: "with space" },
      { line: 8, problem: "barcode_taken", value: "622" },
    ]);
  });

  it("refuses a file without the columns it needs, or with nothing in it", () => {
    expect(parseCostCsv("product,price\nA,1\n").problems).toEqual([{ line: 1, problem: "header" }]);
    expect(parseCostCsv("sku,price\nA,1\n").problems).toEqual([{ line: 1, problem: "header" }]);
    expect(parseCostCsv("").problems).toEqual([{ line: 1, problem: "empty" }]);
    expect(parseCostCsv("sku,cost\n\n").problems).toEqual([{ line: 2, problem: "empty" }]);
    expect(parseCostCsv("sku,cost\nA,\nB,\n").problems).toEqual([{ line: 2, problem: "empty" }]);
  });
});
