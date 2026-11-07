import { expect, test } from "@playwright/test";
import { ownerWithStore, signInOwner } from "./stack";

/**
 * E9-2 profit on the order screen. The numbers are computed and tested in the API (pnl.test,
 * profit.e2e); this stack has no store orders, so the order and its P&L are served by the test.
 */
const egp = (amount: string) => ({ amount, currency: "EGP" });

test("owner in Arabic: an order waiting to confirm shows its expected profit and what is missing", async ({ page }) => {
  const owner = await ownerWithStore("متجر الربح");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  const id = "77777777-7777-4777-8777-777777777777";
  const at = "2026-10-23T09:00:00.000Z";
  await page.route(`**/v1/orders/${id}`, (route) => route.fulfill({ json: {
    id, number: "#7003", externalId: null, status: "pending_confirmation", channel: "store", store: { connectionId: null, provider: "shopify" },
    customer: { label: "منى ع.", phoneLast4: "4821" }, currency: "EGP", total: egp("1250.00"), cod: egp("1250.00"), subtotal: egp("1250.00"), shipping: egp("0.00"),
    discount: egp("0.00"), paid: egp("0.00"), refunded: egp("0.00"), balance: egp("1250.00"), paymentMode: "cod", paymentStatus: "unpaid", risk: null, riskReasons: [], tags: [],
    assignedTo: null, area: { city: "القاهرة", province: null, country: "EG" }, hasLocation: false, redacted: false, placedAt: at,
    timestamps: { placedAt: at, confirmedAt: null, shippedAt: null, deliveredAt: null, cancelledAt: null }, lines: [], payments: [], shipments: [], events: [],
  } }));
  await page.route(`**/v1/orders/${id}/pnl`, (route) => route.fulfill({ json: {
    currency: "EGP", day: "2026-10-23", isFinal: false, flags: ["estimated", "packaging_cost_missing"], computedAt: at,
    revenue: egp("0.00"), refunds: egp("0.00"), productCost: egp("0.00"), shipping: egp("0.00"), codFee: egp("0.00"), paymentFee: egp("0.00"), channelFee: egp("0.00"),
    ads: egp("0.00"), agent: egp("0.00"), packaging: egp("0.00"), returns: egp("0.00"), chargebacks: egp("0.00"), net: egp("0.00"),
    expectedRevenue: egp("1250.00"), expectedNet: egp("359.25"),
  } }));
  await page.goto(`/ar/orders/${id}`);
  const card = page.getByRole("main").getByTestId("profit-card");
  // FX-2: a cost is missing, so the figure is provisional ("~", dashed) and no margin is shown.
  await expect(card).toContainText("ربح مبدئي");
  await expect(card).toContainText(/~‏?359\.25/);
  // The amount reads first in Arabic: inside the LTR-isolated money <bdi>, the RLM marks put the
  // number on the right of "ج.م." (docs/16 §1.2), as Intl ar-EG drew it before.
  const sides = await card.evaluate((el) => {
    const bdi = [...el.querySelectorAll("bdi")].find((b) => b.textContent?.includes("ج.م."));
    const text = bdi?.firstChild?.nodeType === Node.TEXT_NODE ? bdi.firstChild as Text : null;
    if (!text) return null;
    const rect = (s: string) => { const i = text.data.indexOf(s); const r = document.createRange(); r.setStart(text, i); r.setEnd(text, i + s.length); return r.getBoundingClientRect(); };
    const amount = rect("359.25");
    const name = rect("ج.م.");
    return { amountLeft: amount.left, nameRight: name.right };
  });
  expect(sides, "money <bdi> with ج.م.").not.toBeNull();
  expect(sides!.amountLeft).toBeGreaterThanOrEqual(sides!.nameRight - 1);
  await expect(card).not.toContainText("الهامش");
  await expect(card).toContainText("تكلفة التغليف");
  await expect(page.getByRole("main")).toContainText("مبدئي");
  await card.getByRole("link", { name: "حدّد التكاليف" }).click();
  await expect(page).toHaveURL(/\/ar\/settings\/costs$/);
});
