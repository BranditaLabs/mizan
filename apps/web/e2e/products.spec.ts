import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { agentIn, newPhone, ownerWithStore, signInOwner, signInWithPhone } from "./stack";

/**
 * E8-1 products in the browser. The browser stack has no store to sync products from, so the list
 * is served by the test (shapes from the OpenAPI contract); field ownership, barcode clashes and
 * the all-or-nothing import run against the real API in apps/api's products e2e.
 */
const egp = (amount: string) => ({ amount, currency: "EGP" });
const STORE = { connectionId: "44444444-4444-4444-8444-444444444444", provider: "shopify", name: "nile.myshopify.com" };
function variant(id: string, sku: string, title: string | null, cost: string | null, barcode: string | null = null) {
  return { id, title, sku, barcode, barcodeOwner: "store", price: egp("1150.00"), compareAt: null, cost: cost ? egp(cost) : null, available: 4 };
}

test("owner in Arabic: sees what is missing, sets a cost, imports a sheet, downloads the list", async ({ page }) => {
  const owner = await ownerWithStore("متجر المنتجات");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);

  const grey = variant("55555555-5555-4555-8555-555555555552", "ABY-GRY", "رمادي", null);
  const black = variant("55555555-5555-4555-8555-555555555551", "ABY-BLK", "أسود", "400.00", "6221000000011");
  const patches: unknown[] = [];
  await page.route("**/v1/products?*", (route) => route.fulfill({ json: {
    data: [{ id: "66666666-6666-4666-8666-666666666666", title: "عباية سادة", status: "active", store: STORE, variants: [black, grey] }],
    nextCursor: null, counts: { products: 1, variants: 2, missingCost: grey.cost ? 0 : 1, missingBarcode: 1 },
  } }));
  await page.route(`**/v1/products/variants/${grey.id}`, async (route) => {
    const body = route.request().postDataJSON() as { cost?: string };
    patches.push(body);
    if (body.cost) grey.cost = egp(body.cost);
    return route.fulfill({ json: grey });
  });
  let imports = 0;
  await page.route("**/v1/products/costs/import", (route) => (++imports === 1
    ? route.fulfill({ status: 422, contentType: "application/problem+json", json: {
      type: "about:blank", title: "في سطور في الملف ماتقريتش", status: 422, code: "csv_invalid",
      errors: [{ path: "line:3", code: "unknown_sku", message: "NOPE" }],
    } })
    : route.fulfill({ json: { costs: 2, barcodes: 1, skipped: 0, missingCost: 0 } })));

  await page.getByRole("link", { name: "المنتجات" }).click();
  await expect(page).toHaveURL(/\/ar\/products$/);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("المنتجات");
  await expect(main.getByTestId("product-counts")).toContainText("من غير تكلفة");
  await expect(main.getByText("لسه من غير تكلفة")).toBeVisible();
  await expect(main.getByText("من المتجر")).toBeVisible(); // the black abaya's barcode is the store's

  // One cost, typed on an Arabic keyboard.
  await main.getByRole("button", { name: "عدّل ABY-GRY" }).click();
  const editor = page.getByRole("dialog", { name: "عدّل ABY-GRY" });
  await editor.getByLabel("تكلفة القطعة (EGP)").fill("٤٢٠٫٥");
  await editor.getByRole("button", { name: "احفظ" }).click();
  await expect(page.locator(".mz-toast")).toContainText("اتحفظ ABY-GRY");
  expect(patches).toEqual([{ cost: "420.5" }]);

  // A sheet: the bad line is named, then the fixed file goes in.
  await main.getByRole("button", { name: "استورد التكاليف" }).click();
  const dialog = page.getByRole("dialog", { name: "استورد التكاليف من شيت" });
  await dialog.getByLabel("أو الصقه هنا").fill("SKU,Cost\nABY-BLK,400\nNOPE,10\n");
  await dialog.getByRole("button", { name: "استورد" }).click();
  await expect(dialog.getByTestId("cost-import-errors")).toContainText("سطر 3");
  await expect(dialog.getByTestId("cost-import-errors")).toContainText("مفيش منتج بالرمز ده");
  await dialog.getByLabel("أو الصقه هنا").fill("SKU,Cost\nABY-BLK,400\nABY-GRY,420\n");
  await dialog.getByRole("button", { name: "استورد" }).click();
  await expect(page.locator(".mz-toast", { hasText: "اتحفظ تكلفتين وباركود واحد" })).toBeVisible();

  // The list as a sheet, with headers the import reads back.
  const download = page.waitForEvent("download");
  await main.getByRole("button", { name: "نزّل القائمة (CSV)" }).click();
  const csv = await readFile(await (await download).path(), "utf8");
  expect(csv.split("\r\n")[0]).toBe("﻿المنتج,النوع,رمز المنتج,الباركود,السعر,التكلفة");
  expect(csv).toContain("عباية سادة,أسود,ABY-BLK,6221000000011,1150.00,400.00");
});

test("an agent cannot open products", async ({ page }) => {
  const phone = newPhone();
  await agentIn(phone, "Agents Products Store");
  await page.goto("/en/sign-in");
  await signInWithPhone(page, phone, "en");
  await expect(page.getByTestId("store-name")).toHaveText("Agents Products Store");
  await page.goto("/en/products");
  await expect(page.getByRole("main").getByText("Not available for your role")).toBeVisible();
});
