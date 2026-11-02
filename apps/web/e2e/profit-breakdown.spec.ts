import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { ownerWithStore, signInOwner } from "./stack";

/**
 * E9-5 profit breakdown in the browser. The sums and the split by product run in the API's
 * profit-home e2e; this stack has no orders, so: the empty state from the real API, then a
 * breakdown the test serves (shape from the OpenAPI contract), its table and the CSV file.
 */
const egp = (amount: string) => ({ amount, currency: "EGP" });
const row = (key: string, label: string, net: string, special = false) => ({
  key, label, special, orders: 4, delivered: 1, returned: 1, revenue: egp("1000.00"), productCost: egp("800.00"), shippingAndCod: egp("190.00"), ads: egp("300.00"),
  returns: egp("30.00"), team: egp("0.00"), fees: egp("0.00"), net: egp(net), expectedNet: egp("670.00"), margin: net.startsWith("-") ? "-32.0" : "12.5",
});

test("owner in Arabic: profit by product, then by courier, and the CSV for the accountant", async ({ page }) => {
  const owner = await ownerWithStore("متجر الأرباح");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await page.getByRole("link", { name: "الأرباح" }).click();
  await expect(page).toHaveURL(/\/ar\/profit$/);
  const main = page.getByTestId("profit-breakdown");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("تفاصيل الأرباح");
  await expect(main).toContainText("مفيش أوردرات في الفترة دي"); // the real API: a new store

  await page.route("**/v1/profit/breakdown?*", (route) => {
    const by = new URL(route.request().url()).searchParams.get("by")!;
    const rows = by === "courier" ? [row("none", "none", "-320.00", true)] : [row("v1", "عباية سادة, أسود", "125.00"), row("v2", "طرحة", "-320.00")];
    return route.fulfill({ json: { by, from: "2026-09-25", to: "2026-10-24", baseCurrency: "EGP", rows, total: row("total", "total", "-195.00") } });
  });
  await main.getByRole("button", { name: "آخر 7 يوم" }).click();
  const table = main.getByTestId("breakdown-table");
  await expect(table).toContainText("عباية سادة, أسود");
  await expect(table).toContainText("12.5٪");
  await expect(table).toContainText("الإجمالي");
  await expect(table).toContainText("1 اتسلّم · 1 اترفض");
  await page.setViewportSize({ width: 1280, height: 900 });
  await main.screenshot({ path: "test-results/profit-breakdown-ar.png" });

  const [download] = await Promise.all([page.waitForEvent("download"), main.getByRole("button", { name: "نزّل ملف CSV" }).click()]);
  expect(download.suggestedFilename()).toBe("mizan-profit-product-2026-09-25-2026-10-24.csv");
  const csv = await readFile((await download.path())!, "utf8");
  const lines = csv.replace(/^﻿/, "").trim().split("\r\n");
  expect(lines[0]).toBe("المنتج,الأوردرات,اتسلّم,اترفض أو رجع,الإيراد,تكلفة المنتج,الشحن والتحصيل,الإعلانات,شحن المرتجع,الفريق,الرسوم,الربح,الربح المتوقع,الهامش");
  expect(lines[1]).toBe('"عباية سادة, أسود",4,1,1,1000.00,800.00,190.00,300.00,30.00,0.00,0.00,125.00,670.00,12.5');
  expect(lines.at(-1)).toBe("الإجمالي,4,1,1,1000.00,800.00,190.00,300.00,30.00,0.00,0.00,-195.00,670.00,-32.0");

  await main.getByRole("button", { name: "شركة الشحن" }).click();
  await expect(table).toContainText("لسه ماتشحنش");
});
