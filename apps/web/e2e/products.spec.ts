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
  return { id, title, sku, barcode, barcodeOwner: "store", price: egp("1150.00"), compareAt: null, cost: cost ? egp(cost) : null, available: 4, options: [] as Array<{ name: string; value: string }>, imageId: null as string | null };
}
const ABAYA = { id: "66666666-6666-4666-8666-666666666666", title: "عباية سادة", status: "active", store: STORE, mainImage: null, imageCount: 0, vendor: null, productType: null, tags: [], options: [] };
/** A 1x1 picture, served for the store's CDN address so the test needs no network. */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("owner in Arabic: sees what is missing, sets a cost, imports a sheet, downloads the list", async ({ page }) => {
  const owner = await ownerWithStore("متجر المنتجات");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);

  const grey = variant("55555555-5555-4555-8555-555555555552", "ABY-GRY", "رمادي", null);
  const black = variant("55555555-5555-4555-8555-555555555551", "ABY-BLK", "أسود", "400.00", "6221000000011");
  const patches: unknown[] = [];
  await page.route("**/v1/products?*", (route) => route.fulfill({ json: {
    data: [{ ...ABAYA, variants: [black, grey] }],
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

test("the product page in English: pictures with the main one, details, plain-text description, variants with margin", async ({ page }) => {
  const owner = await ownerWithStore("Products Detail Store");
  await page.goto("/en/sign-in");
  await signInOwner(page, owner, "en");
  await expect(page).toHaveURL(/\/en$/);

  const pic = (n: number, isMain: boolean) => ({ id: `77777777-7777-4777-8777-77777777777${n}`, url: `https://cdn.shopify.com/s/files/1/linen-${n}.jpg`, alt: n === 1 ? "Front" : null, width: 1200, height: 1500, isMain });
  const images = [pic(1, false), pic(2, true), pic(3, false)];
  const v = (n: number, colour: string, size: string, cost: string | null, image: number) => ({
    ...variant(`55555555-5555-4555-8555-55555555556${n}`, `LIN-${colour}-${size}`, `${colour} / ${size}`, cost),
    options: [{ name: "Color", value: colour }, { name: "Size", value: size }], imageId: images[image]!.id,
  });
  const linen = {
    ...ABAYA, id: "88888888-8888-4888-8888-888888888888", title: "Linen Abaya", vendor: "Nile Wear", productType: "Abaya", tags: ["linen", "summer"],
    options: [{ name: "Color", values: ["Black", "Sand"] }, { name: "Size", values: ["S", "M"] }],
    handle: "linen-abaya", description: "Soft linen & cotton.\n• Machine wash", images, storeUrl: "https://admin.shopify.com/store/nile/products/9", updatedAt: new Date().toISOString(),
    variants: [v(1, "Black", "S", "500.00", 0), v(2, "Sand", "M", null, 1)],
    totals: { variants: 2, available: 8, priceMin: egp("1150.00"), priceMax: egp("1150.00"), missingCost: 1, missingBarcode: 2 },
  };
  await page.route("https://cdn.shopify.com/**", (route) => route.fulfill({ contentType: "image/png", body: PIXEL }));
  await page.route("**/v1/products?*", (route) => route.fulfill({ json: {
    data: [{ ...linen, mainImage: images[1], imageCount: 3 }], nextCursor: null, counts: { products: 1, variants: 2, missingCost: 1, missingBarcode: 2 },
  } }));
  await page.route(`**/v1/products/${linen.id}`, (route) => route.fulfill({ json: linen }));

  await page.goto("/en/products");
  const main = page.getByRole("main");
  await main.getByRole("link", { name: "Linen Abaya" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/en/products/${linen.id}$`));
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Linen Abaya");

  // The main picture is shown first and marked; choosing another shows it.
  const gallery = main.getByTestId("product-gallery");
  await expect(gallery.getByText("Main picture")).toBeVisible();
  await expect(gallery.locator("img").first()).toHaveAttribute("src", images[1]!.url);
  await expect(gallery.locator("img").first()).toHaveAttribute("referrerpolicy", "no-referrer");
  await gallery.getByRole("button", { name: "Show picture 1 of 3" }).click();
  await expect(gallery.locator("img").first()).toHaveAttribute("src", images[0]!.url);
  await expect(gallery.getByText("Main picture")).toHaveCount(0);

  await expect(main.getByText("Nile Wear")).toBeVisible();
  await expect(main.getByText("Black, Sand")).toBeVisible();
  await expect(main.getByTestId("product-description")).toHaveText("Soft linen & cotton.\n• Machine wash");
  await expect(main.getByRole("link", { name: "Edit in Shopify" })).toHaveAttribute("href", linen.storeUrl);
  // Margin on the price when the cost is known: (1150 - 500) / 1150 = 57%.
  await expect(main.getByRole("row", { name: /LIN-Black-S/ })).toContainText("57%");
  await expect(main.getByRole("row", { name: /LIN-Sand-M/ })).toContainText("No cost yet");
});
