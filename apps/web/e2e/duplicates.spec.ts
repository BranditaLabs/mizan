import { expect, test } from "@playwright/test";
import { ownerWithStore, signInOwner } from "./stack";

/**
 * E5-3 likely duplicates in the browser. Detection, the confirmation hold, keep and merge run in
 * the API's duplicates e2e; this stack has no store orders, so here: the Duplicates tab against
 * the real API, and an order the test serves with its banner, keep and merge.
 */
const egp = (amount: string) => ({ amount, currency: "EGP" });
const at = "2026-10-23T09:00:00.000Z";
const ORDER = (id: string, status: "suspected" | "merged") => ({
  id, number: "#9402", externalId: null, status: status === "merged" ? "cancelled" : "new", channel: "store", store: { connectionId: null, provider: "shopify" },
  customer: { label: "منى ع.", phoneLast4: "4821" }, currency: "EGP", total: egp("1150.00"), cod: egp("1150.00"), subtotal: egp("1150.00"), shipping: egp("0.00"),
  discount: egp("0.00"), paid: egp("0.00"), refunded: egp("0.00"), balance: egp("1150.00"), paymentMode: "cod", paymentStatus: "unpaid", risk: null, riskReasons: [], tags: [],
  assignedTo: null, area: { city: "مدينة نصر", province: null, country: "EG" }, hasLocation: false, redacted: false, placedAt: at, duplicate: status,
  duplicateOf: { id: "11111111-1111-4111-8111-111111111111", number: "#9401", status: "pending_confirmation", items: ["سيروم فيتامين سي", "واقي شمس"], minutesApart: 80 },
  timestamps: { placedAt: at, confirmedAt: null, shippedAt: null, deliveredAt: null, cancelledAt: null }, lines: [], payments: [], shipments: [], events: [],
});

test("owner in Arabic: the Duplicates tab, then an order held as a duplicate is merged", async ({ page }) => {
  const owner = await ownerWithStore("متجر المكرر");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);

  await page.goto("/ar/orders");
  const main = page.getByRole("main");
  const tabs = main.getByRole("tablist", { name: "حالة الأوردر" });
  await tabs.getByRole("tab", { name: /مكرر/ }).click();
  await expect(page).toHaveURL(/status=duplicates/);
  await expect(tabs.getByRole("tab", { name: /مكرر/ })).toHaveAttribute("aria-selected", "true");
  await expect(main.getByText("مفيش أوردرات لسه")).toBeVisible(); // a new store: the setup empty state comes first

  const id = "22222222-2222-4222-8222-222222222222";
  let merged = false;
  await page.route(`**/v1/orders/${id}`, (route) => route.fulfill({ json: ORDER(id, merged ? "merged" : "suspected") }));
  await page.route(`**/v1/orders/${id}/pnl`, (route) => route.fulfill({ status: 404, json: { type: "about:blank", title: "x", status: 404, code: "not_found" } }));
  await page.route(`**/v1/orders/${id}/confirmation`, (route) => route.fulfill({ json: null }));
  await page.route(`**/v1/orders/${id}/duplicate`, async (route) => {
    expect(route.request().postDataJSON()).toEqual({ action: "merge" });
    merged = true;
    await route.fulfill({ json: { status: "merged" } });
  });
  await page.goto(`/ar/orders/${id}`);
  const banner = page.getByTestId("duplicate-banner");
  await expect(banner).toContainText("ممكن يكون أوردر مكرر");
  await expect(banner).toContainText("80 دقيقة");
  await expect(banner).toContainText("سيروم فيتامين سي و واقي شمس".replace(" و ", " و"));
  await expect(banner.getByRole("link", { name: "#9401" })).toHaveAttribute("href", "/ar/orders/11111111-1111-4111-8111-111111111111");

  await banner.getByRole("button", { name: "ادمجه في الأوردر الأولاني" }).click();
  const dialog = page.getByRole("dialog", { name: "تدمج الأوردر ده؟" });
  await expect(dialog).toContainText("mizan-duplicate");
  await dialog.getByRole("button", { name: "ادمجه في الأوردر الأولاني" }).click();
  await expect(page.locator(".mz-toast")).toContainText("اتدمج");
  await expect(main.getByText(/اتدمج في/)).toBeVisible();
  await expect(page.getByTestId("duplicate-banner")).toHaveCount(0);
});
