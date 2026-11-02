import { expect, test } from "@playwright/test";
import { agentIn, newPhone, ownerWithStore, signInOwner, signInWithPhone } from "./stack";

/**
 * E8-2 stock in the browser. The browser stack has no store to sync products from, so stock is
 * served by the test (shapes from the OpenAPI contract); reservations, the oversell block and the
 * ledger run against the real API in apps/api's stock e2e.
 */
const ABAYA = "77777777-7777-4777-8777-777777777771";
const SCARF = "77777777-7777-4777-8777-777777777772";

test("owner in Arabic: sees orders waiting for stock, receives stock, reads an item's history", async ({ page }) => {
  const owner = await ownerWithStore("متجر المخزون");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);

  let received = false;
  const posted: unknown[] = [];
  await page.route("**/v1/stock?*", (route) => route.fulfill({ json: {
    data: [
      { variantId: ABAYA, productTitle: "عباية سادة", variantTitle: "أسود", sku: "ABY-1", barcode: null, counted: true, onHand: received ? 7 : 5, reserved: received ? 6 : 2, available: received ? 1 : 3, storeAvailable: 40, lowStockAt: null },
      { variantId: SCARF, productTitle: "طرحة", variantTitle: null, sku: "SCF-1", barcode: null, counted: false, onHand: null, reserved: null, available: null, storeAvailable: 12, lowStockAt: null },
    ],
    nextCursor: null, warehouse: { id: "88888888-8888-4888-8888-888888888888", name: "المخزن الرئيسي" },
    counts: { variants: 2, counted: 1, out: 0, low: 0, waitingOrders: received ? 0 : 1 },
  } }));
  await page.route("**/v1/stock/movements", (route) => {
    posted.push(route.request().postDataJSON());
    received = true;
    return route.fulfill({ json: { applied: 1, levels: [{ variantId: ABAYA, onHand: 7, reserved: 6, available: 1 }], ordersReserved: 1 } });
  });
  await page.route(`**/v1/stock/${ABAYA}/movements`, (route) => route.fulfill({ json: { data: [
    { id: "99999999-9999-4999-8999-999999999992", at: "2026-10-26T10:00:00.000Z", kind: "reserve", delta: 4, reason: null, note: null, order: { id: "99999999-9999-4999-8999-999999999990", number: "M-1002" } },
    { id: "99999999-9999-4999-8999-999999999991", at: "2026-10-26T09:00:00.000Z", kind: "count", delta: 5, reason: null, note: null, order: null },
  ] } }));

  await page.getByRole("link", { name: "المخزن" }).click();
  await expect(page).toHaveURL(/\/ar\/stock$/);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("المخزون");
  await expect(main.getByText("أوردر متأكد واحد مستني مخزون")).toBeVisible();
  await expect(main.getByRole("link", { name: "شوف الأوردرات" })).toHaveAttribute("href", "/ar/orders?status=waiting_stock");
  await expect(main.getByText("ماتعدّش", { exact: true })).toBeVisible(); // the scarf follows the store until counted

  await main.getByRole("button", { name: "حدّث ABY-1" }).click();
  const editor = page.getByRole("dialog", { name: "حدّث ABY-1" });
  await expect(editor).toContainText("دلوقتي: 5 موجود، 2 محجوز، 3 متاح.");
  await editor.getByLabel("عدد القطع اللي وصلت").fill("٢");
  await editor.getByRole("button", { name: "احفظ", exact: true }).click();
  await expect(page.locator(".mz-toast", { hasText: "أوردر واحد مستني اتحجز دلوقتي" })).toBeVisible();
  expect(posted).toEqual([{ items: [{ variantId: ABAYA, kind: "receive", quantity: 2 }] }]);
  await expect(main.getByText("أوردر متأكد واحد مستني مخزون")).toHaveCount(0);

  await main.getByRole("button", { name: "سجل ABY-1" }).click();
  const history = page.getByRole("dialog", { name: "سجل ABY-1" }).getByTestId("stock-history");
  await expect(history).toContainText("اتحجز لأوردر");
  await expect(history).toContainText("M-1002");
  await expect(history).toContainText("اتعدّ");
});

test("an agent cannot open stock", async ({ page }) => {
  const phone = newPhone();
  await agentIn(phone, "Agents Stock Store");
  await page.goto("/en/sign-in");
  await signInWithPhone(page, phone, "en");
  await expect(page.getByTestId("store-name")).toHaveText("Agents Stock Store");
  await page.goto("/en/stock");
  await expect(page.getByRole("main").getByText("Not available for your role")).toBeVisible();
});

test("manager in Arabic: turns on sending stock to the store and sets a low-stock alert", async ({ page }) => {
  const owner = await ownerWithStore("متجر التنبيهات");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);

  let push = false;
  const thresholds: unknown[] = [];
  await page.route("**/v1/settings/inventory", async (route) => {
    if (route.request().method() === "PUT") push = (route.request().postDataJSON() as { pushToStore: boolean }).pushToStore;
    return route.fulfill({ json: { pushToStore: push } });
  });
  await page.route("**/v1/stock?*", (route) => route.fulfill({ json: {
    data: [{ variantId: ABAYA, productTitle: "عباية سادة", variantTitle: null, sku: "ABY-1", barcode: null, counted: true, onHand: 4, reserved: 0, available: 4, storeAvailable: 9, lowStockAt: 5 }],
    nextCursor: null, warehouse: { id: "88888888-8888-4888-8888-888888888888", name: "المخزن الرئيسي" },
    counts: { variants: 1, counted: 1, out: 0, low: 1, waitingOrders: 0 },
  } }));
  await page.route(`**/v1/stock/${ABAYA}`, (route) => {
    thresholds.push(route.request().postDataJSON());
    return route.fulfill({ json: { variantId: ABAYA, lowStockAt: 3, available: 4 } });
  });

  await page.goto("/ar/stock");
  const main = page.getByRole("main");
  const sync = main.getByRole("switch", { name: /ابعت مخزون ميزان لمتجري/ });
  await expect(sync).not.toBeChecked();
  await sync.click(); // saved first, then shown on
  await expect(page.locator(".mz-toast", { hasText: "متجرك بقى بياخد أرقام ميزان" })).toBeVisible();
  expect(push).toBe(true);
  await expect(sync).toBeChecked();
  await expect(main.getByRole("tab", { name: "قرب يخلص" })).toBeVisible();

  await main.getByRole("button", { name: "حدّث ABY-1" }).click();
  const editor = page.getByRole("dialog", { name: "حدّث ABY-1" });
  await editor.getByLabel("نبّهني عند").fill("٣");
  await editor.getByRole("button", { name: "احفظ التنبيه" }).click();
  await expect(page.locator(".mz-toast", { hasText: "هننبّهك لما ABY-1 يوصل لـ 3" })).toBeVisible();
  expect(thresholds).toEqual([{ lowStockAt: 3 }]);
});
