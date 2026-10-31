import { expect, test, type Page } from "@playwright/test";
import { ownerWithStore, signInOwner } from "./stack";

/**
 * M16-2 purchasing in the browser. Suppliers run against the real API; the browser stack has no
 * store to sync products from, so items and purchase orders are served by the test (shapes from
 * the OpenAPI contract). Approval rules, receiving and the moving-average cost run against the
 * real API in apps/api's purchasing e2e.
 */
const ABAYA = "77777777-7777-4777-8777-777777777771";
const SCARF = "77777777-7777-4777-8777-777777777772";
const PO_ID = "99999999-9999-4999-8999-999999999991";

function po(status: string, received: [number, number], receipts: object[] = [], landed = false) {
  return {
    id: PO_ID, number: "PO-0001", status, supplier: { id: "", name: "" }, total: { amount: "1200.00", currency: "EGP" }, items: 2, units: 15,
    receivedUnits: received[0] + received[1], expectedAt: "2026-11-05", late: false, createdAt: "2026-10-30T08:00:00.000Z", notes: "دفعة الشتا",
    approvedAt: status === "draft" ? null : "2026-10-30T08:05:00.000Z", sentAt: null, receivedAt: null, cancelledAt: null, needsOwner: false,
    lines: [
      { id: "aaaaaaaa-0000-4000-8000-000000000001", variantId: ABAYA, sku: "ABY-1", barcode: "6221000000101", title: "عباية سادة", quantity: 10, received: received[0], damaged: 0, unitCost: { amount: "100.00", currency: "EGP" }, landedUnitCost: landed ? { amount: "150.00", currency: "EGP" } : null },
      { id: "aaaaaaaa-0000-4000-8000-000000000002", variantId: SCARF, sku: "SCF-1", barcode: null, title: "طرحة", quantity: 5, received: received[1], damaged: 0, unitCost: { amount: "40.00", currency: "EGP" }, landedUnitCost: landed ? { amount: "60.00", currency: "EGP" } : null },
    ],
    receipts,
    landedCosts: landed ? [{ id: "cccccccc-0000-4000-8000-000000000001", kind: "freight", amount: { amount: "600.00", currency: "EGP" }, allocateBy: "value", description: "إسكندرية للقاهرة", createdAt: "2026-10-30T08:10:00.000Z" }] : [],
  };
}

async function servePurchasing(page: Page, supplier: { id: string; name: string }) {
  const sent: Record<string, unknown[]> = { create: [], receive: [], landed: [] };
  let landed = false;
  let state = po("draft", [0, 0]);
  const reply = () => ({ ...state, ...(landed ? { landedCosts: po("draft", [0, 0], [], true).landedCosts, lines: po(state.status, [state.lines[0]!.received, state.lines[1]!.received], state.receipts, true).lines } : {}), supplier });
  await page.route(`**/v1/purchase-orders/${PO_ID}/landed-costs`, (route) => {
    sent.landed!.push(route.request().postDataJSON());
    landed = true;
    return route.fulfill({ status: 201, json: reply() });
  });
  await page.route("**/v1/orders/products*", (route) => route.fulfill({ json: { data: [
    { variantId: ABAYA, sku: "ABY-1", title: "عباية سادة", price: { amount: "500.00", currency: "EGP" }, available: 4 },
    { variantId: SCARF, sku: "SCF-1", title: "طرحة", price: { amount: "150.00", currency: "EGP" }, available: 0 },
  ] } }));
  await page.route("**/v1/purchase-orders?*", (route) => route.fulfill({ json: {
    data: [{ ...reply(), notes: undefined }].map(({ id, number, status, supplier: s, total, items, units, receivedUnits, expectedAt, late, createdAt }) => ({ id, number, status, supplier: s, total, items, units, receivedUnits, expectedAt, late, createdAt })),
    counts: { draft: 0, approved: 0, sent: 0, partially_received: state.status === "partially_received" ? 1 : 0, received: 0, cancelled: 0 },
  } }));
  await page.route("**/v1/purchase-orders", (route) => {
    sent.create!.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: reply() });
  });
  await page.route(`**/v1/purchase-orders/${PO_ID}`, (route) => route.fulfill({ json: reply() }));
  await page.route(`**/v1/purchase-orders/${PO_ID}/approve`, (route) => { state = po("approved", [0, 0]); return route.fulfill({ json: reply() }); });
  await page.route(`**/v1/purchase-orders/${PO_ID}/receipts`, (route) => {
    sent.receive!.push(route.request().postDataJSON());
    state = po("partially_received", [6, 5], [{ id: "bbbbbbbb-0000-4000-8000-000000000001", number: 1, receivedAt: "2026-10-30T09:00:00.000Z", units: 11, damaged: 0, costStatus: "applied", fxRate: "1", overApproved: false, viaApp: false }]);
    return route.fulfill({ status: 201, json: reply() });
  });
  return sent;
}

test("owner in Arabic: adds a supplier, drafts a PO, approves it and receives part of the delivery", async ({ page }) => {
  const owner = await ownerWithStore("متجر المشتريات");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);

  // Suppliers, against the real API.
  await page.getByRole("navigation", { name: "القايمة الرئيسية" }).getByRole("link", { name: "المشتريات" }).click();
  await expect(page).toHaveURL(/\/ar\/purchasing$/);
  await expect(page.getByTestId("purchase-orders")).toContainText("مفيش حاجة في الطريق");
  await page.getByRole("link", { name: "الموردين" }).click();
  await page.getByRole("main").getByRole("button", { name: "ضيف مورد" }).click();
  const dialog = page.getByRole("dialog", { name: "ضيف مورد" });
  await dialog.getByLabel("الاسم").fill("إسكندرية للنسيج");
  await dialog.getByLabel("مدة التوريد (أيام)").fill("7");
  await dialog.getByLabel("التليفون").fill("+20 3 480 1234");
  await dialog.getByRole("button", { name: "احفظ" }).click();
  await expect(page.locator(".mz-toast", { hasText: "اتحفظ" })).toBeVisible();
  const suppliers = page.getByTestId("suppliers");
  await expect(suppliers.getByRole("row", { name: /إسكندرية للنسيج/ })).toContainText("7 أيام");
  await expect(suppliers.getByRole("row", { name: /إسكندرية للنسيج/ })).toContainText("+2034801234");
  await page.getByRole("main").getByRole("button", { name: "ضيف مورد" }).click();
  await page.getByRole("dialog").getByLabel("الاسم").fill("إسكندرية للنسيج");
  await page.getByRole("dialog").getByRole("button", { name: "احفظ" }).click();
  await expect(page.getByRole("dialog")).toContainText("فيه مورد بالاسم ده");
  await page.getByRole("dialog").getByRole("button", { name: "إلغاء" }).click();

  // The PO itself, served by the test.
  const sent = await servePurchasing(page, { id: "", name: "إسكندرية للنسيج" });
  await page.goto("/ar/purchasing/new");
  const form = page.getByTestId("new-po");
  await form.getByRole("button", { name: "احفظ مسودة" }).click();
  await expect(form).toContainText("اختار مورد");
  await form.getByLabel("المورد", { exact: true }).selectOption({ label: "إسكندرية للنسيج" });
  await expect(form.getByLabel("العملة")).toHaveValue("EGP");
  await form.getByRole("combobox", { name: "ضيف صنف" }).fill("عباية");
  await page.getByRole("option", { name: /عباية سادة/ }).click();
  await form.getByRole("combobox", { name: "ضيف صنف" }).fill("طرحة");
  await page.getByRole("option", { name: /طرحة/ }).click();
  const lines = form.getByTestId("po-lines");
  await lines.getByRole("listitem").nth(0).getByLabel("الكمية").fill("10");
  await lines.getByRole("listitem").nth(0).getByLabel("تكلفة القطعة (EGP)").fill("100");
  await lines.getByRole("listitem").nth(1).getByLabel("الكمية").fill("5");
  await lines.getByRole("listitem").nth(1).getByLabel("تكلفة القطعة (EGP)").fill("40.5.0");
  await form.getByRole("button", { name: "احفظ مسودة" }).click();
  await expect(form).toContainText("صلّح الأصناف اللي فوق");
  await lines.getByRole("listitem").nth(1).getByLabel("تكلفة القطعة (EGP)").fill("40");
  await expect(form).toContainText("1,200.00");
  await form.getByRole("button", { name: "احفظ مسودة" }).click();
  await expect(page).toHaveURL(new RegExp(`/ar/purchasing/${PO_ID}$`));
  expect(sent.create).toEqual([expect.objectContaining({
    currency: "EGP", lines: [{ variantId: ABAYA, quantity: 10, unitCost: "100" }, { variantId: SCARF, quantity: 5, unitCost: "40" }],
  })]);

  const detail = page.getByTestId("purchase-order");
  await expect(detail.getByRole("heading", { level: 1 })).toContainText("PO-0001");
  await expect(detail).toContainText("مسودة");
  // Freight on the draft: spread by value into each unit's cost.
  const costs = detail.getByTestId("landed-costs");
  await costs.getByLabel("المبلغ").fill("600");
  await costs.getByLabel("ملاحظة").fill("إسكندرية للقاهرة");
  await costs.getByRole("button", { name: "ضيف مصروف" }).click();
  await expect(page.locator(".mz-toast", { hasText: "المصروف اتضاف" })).toBeVisible();
  expect(sent.landed).toEqual([{ kind: "freight", amount: "600", currency: "EGP", allocateBy: "value", description: "إسكندرية للقاهرة" }]);
  await expect(costs).toContainText("شحن");
  await expect(detail.getByRole("row", { name: /عباية سادة/ })).toContainText("150.00");
  await expect(detail.getByRole("link", { name: "عدّل المسودة" })).toBeVisible();
  await detail.getByRole("button", { name: "وافق" }).click();
  await expect(page.locator(".mz-toast", { hasText: "اتوافق عليه" })).toBeVisible();
  await detail.getByRole("button", { name: "استلم التسليم" }).click();
  const receive = page.getByRole("dialog", { name: "استلام PO-0001" });
  await expect(receive).toContainText("لسه مستنيين 10");
  await receive.getByRole("listitem").nth(0).getByLabel("سليم").fill("6");
  await receive.getByRole("listitem").nth(1).getByLabel("سليم").fill("7");
  // More than ordered: a manager may tick it; until then nothing can be sent.
  await expect(receive.getByRole("button", { name: "استلم", exact: true })).toBeDisabled();
  await receive.getByRole("checkbox", { name: "استلم أكتر من المطلوب (مدير)" }).check();
  await expect(receive.getByRole("button", { name: "استلم", exact: true })).toBeEnabled();
  await receive.getByRole("listitem").nth(1).getByLabel("سليم").fill("5");
  await receive.getByRole("checkbox", { name: "استلم أكتر من المطلوب (مدير)" }).waitFor({ state: "detached" });
  await receive.getByRole("button", { name: "استلم", exact: true }).click();
  await expect(page.locator(".mz-toast", { hasText: "التسليم اتستلم" })).toBeVisible();
  expect(sent.receive).toEqual([{ items: [{ variantId: ABAYA, quantity: 6, damaged: 0 }, { variantId: SCARF, quantity: 5, damaged: 0 }], allowOver: false }]);
  await expect(detail).toContainText("وصل جزء");
  await expect(detail.getByTestId("po-receipts")).toContainText("تسليم 1");
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.screenshot({ path: "test-results/purchase-order-ar.png", fullPage: true });
});

test("Settings → Purchasing in English: the owner sets the approval limit", async ({ page }) => {
  const owner = await ownerWithStore("Purchasing Settings Store");
  await page.goto("/en/sign-in");
  await signInOwner(page, owner, "en");
  await expect(page).toHaveURL(/\/en$/); // signed in before leaving the sign-in page
  await page.goto("/en/settings/purchasing");
  const screen = page.getByTestId("purchasing-settings");
  await expect(screen.getByLabel("Owner approval over (store currency)")).toHaveValue("50000.00");
  await screen.getByLabel("Owner approval over (store currency)").fill("1000");
  await screen.getByRole("button", { name: "Save" }).click();
  await expect(page.locator(".mz-toast", { hasText: "Saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("purchasing-settings").getByLabel("Owner approval over (store currency)")).toHaveValue("1000.00");
});

test("reorder in English: suggestions by supplier, a quantity changed, a draft PO from them", async ({ page }) => {
  const owner = await ownerWithStore("Reorder Store");
  await page.goto("/en/sign-in");
  await signInOwner(page, owner, "en");
  await expect(page).toHaveURL(/\/en$/);
  const supplierId = "55555555-5555-4555-8555-555555555551";
  let posted: unknown = null;
  await page.route("**/v1/reorder-suggestions*", (route) => route.fulfill({ json: {
    settings: { safetyDays: 7, targetCoverDays: 30, velocityDays: 28 },
    data: [
      { variantId: ABAYA, sku: "ABY-1", title: "Plain abaya", available: 10, incoming: 0, unitsOut: 56, velocity: 2, daysCover: 5, leadDays: 7, reorderPoint: 28, suggested: 64, packSize: 1,
        supplier: { id: supplierId, name: "Alex Textiles", currency: "EGP" }, lastUnitCost: { amount: "80.00", currency: "EGP" } },
      { variantId: SCARF, sku: "SCF-1", title: "Scarf", available: 2, incoming: 0, unitsOut: 28, velocity: 1, daysCover: 2, leadDays: 14, reorderPoint: 21, suggested: 48, packSize: 12,
        supplier: null, lastUnitCost: null },
    ],
  } }));
  await page.route("**/v1/purchase-orders/from-suggestions", (route) => {
    posted = route.request().postDataJSON();
    return route.fulfill({ status: 201, json: { ...po("draft", [0, 0]), supplier: { id: supplierId, name: "Alex Textiles" } } });
  });
  await page.route(`**/v1/purchase-orders/${PO_ID}`, (route) => route.fulfill({ json: { ...po("draft", [0, 0]), supplier: { id: supplierId, name: "Alex Textiles" } } }));
  await page.goto("/en/purchasing/reorder");
  const screen = page.getByTestId("reorder");
  await expect(screen).toContainText("sales over the last 28 days");
  await expect(screen).toContainText("No supplier yet");
  await expect(screen).toContainText("5 days left");
  await expect(screen).toContainText("In packs of 12");
  await screen.getByLabel("Quantity").first().fill("60");
  await screen.getByRole("button", { name: "Draft a PO with 1 item" }).click();
  await expect(page).toHaveURL(new RegExp(`/en/purchasing/${PO_ID}$`));
  expect(posted).toEqual({ supplierId, items: [{ variantId: ABAYA, quantity: 60 }] });
});
