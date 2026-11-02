import { describe, expect, it } from "vitest";
import { columnName, crc32, csv, xlsx } from "../src/platform/xlsx.js";

/** E15-2: the export files, read back the way Excel would. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Map<string, string>();
  let i = 0;
  while (v.getUint32(i, true) === 0x04034b50) {
    const crc = v.getUint32(i + 14, true);
    const size = v.getUint32(i + 18, true);
    const nameLen = v.getUint16(i + 26, true);
    const extra = v.getUint16(i + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nameLen));
    const data = bytes.subarray(i + 30 + nameLen + extra, i + 30 + nameLen + extra + size);
    expect(crc32(data)).toBe(crc);
    out.set(name, new TextDecoder().decode(data));
    i += 30 + nameLen + extra + size;
  }
  expect(v.getUint32(bytes.length - 22, true)).toBe(0x06054b50); // end of central directory
  expect(v.getUint16(bytes.length - 22 + 10, true)).toBe(out.size);
  return out;
}

describe("xlsx and csv exports", () => {
  it("CRC-32 matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("names columns past Z", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  });
  it("writes a workbook Excel can open: numbers as numbers, text escaped, Arabic right to left", () => {
    const files = unzip(xlsx("لوحة / التشغيل", [["المقياس", "القيمة"], ["نسبة التسليم", 82.4], ["<b> & \"x\"", null], ["=HYPERLINK(1)", 3]], { rtl: true }));
    expect([...files.keys()]).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/worksheets/sheet1.xml"]);
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain('rightToLeft="1"');
    expect(sheet).toContain('<c r="B2"><v>82.4</v></c>');
    expect(sheet).toContain("&lt;b&gt; &amp; &quot;x&quot;");
    expect(sheet).toContain('<c r="A4" t="inlineStr"><is><t xml:space="preserve">=HYPERLINK(1)</t></is></c>'); // text, never a formula
    expect(sheet).not.toContain("<f>");
    expect(files.get("xl/workbook.xml")).toContain('name="لوحة   التشغيل"');
  });
  it("writes CSV for Excel: BOM, quoted where needed, formulas defused, numbers kept", () => {
    expect(csv([["a", "b,c"], ["say \"hi\"", 1.5], ["=1+1", -3], ["-12.50", null]])).toBe('﻿a,"b,c"\r\n"say ""hi""",1.5\r\n\'=1+1,-3\r\n-12.50,\r\n');
  });
});
