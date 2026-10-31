import { expect, test } from "@playwright/test";
import { ownerWithStore, signInOwner } from "./stack";

/**
 * E6-11 offers in the browser: Settings → Offers against the real API (off by default, turned on,
 * caps validated), and the offer on the order card (the order is served by the test, shapes from
 * the OpenAPI contract; the WhatsApp flow and the recommender run in the API's tests).
 */
const egp = (amount: string) => ({ amount, currency: "EGP" });

test("owner in Arabic: Settings → Offers starts off, validates the caps, and saves", async ({ page }) => {
  const owner = await ownerWithStore("متجر العروض");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await page.goto("/ar/settings/offers");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("العروض");
  await expect(main.getByRole("link", { name: "العروض" })).toHaveAttribute("aria-current", "page");
  const toggle = main.getByRole("switch", { name: /اعرض حاجة كمان لما العميل يأكّد/ });
  await expect(toggle).not.toBeChecked();
  await expect(main.getByTestId("offer-summary")).toContainText("عروض اتعرضت");
  await expect(main).toContainText("لسه مفيش قواعد");

  await toggle.check();
  await main.getByLabel("خصم الاقتراحات (%)").fill("20");
  await expect(main).toContainText("لازم يكون أقل من أو يساوي أقصى خصم");
  await expect(main.getByRole("button", { name: "احفظ" })).toBeDisabled();
  await main.getByLabel("خصم الاقتراحات (%)").fill("10");
  await main.getByRole("button", { name: "احفظ" }).click();
  await expect(page.locator(".mz-toast")).toContainText("اتحفظ");
  await page.reload();
  await expect(main.getByRole("switch", { name: /اعرض حاجة كمان لما العميل يأكّد/ })).toBeChecked();
});

test("order detail: the offer and the team's answer to it", async ({ page }) => {
  const owner = await ownerWithStore("متجر عرض الأوردر");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  const id = "77777777-7777-4777-8777-777777777777";
  const at = "2026-10-23T09:00:00.000Z";
  await page.route(`**/v1/orders/${id}`, (route) => route.fulfill({ json: {
    id, number: "#7003", externalId: null, status: "pending_confirmation", channel: "store", store: { connectionId: null, provider: "shopify" },
    customer: { label: "منى ع.", phoneLast4: "4821" }, currency: "EGP", total: egp("1250.00"), cod: egp("1250.00"), subtotal: egp("1200.00"), shipping: egp("50.00"),
    discount: egp("0.00"), paid: egp("0.00"), refunded: egp("0.00"), balance: egp("1250.00"), paymentMode: "cod", paymentStatus: "unpaid", risk: null, riskReasons: [], tags: [],
    assignedTo: null, area: { city: "مدينة نصر", province: null, country: "EG" }, hasLocation: false, redacted: false, placedAt: at,
    timestamps: { placedAt: at, confirmedAt: null, shippedAt: null, deliveredAt: null, cancelledAt: null }, lines: [], payments: [], shipments: [], events: [],
  } }));
  let decided: unknown = null;
  await page.route(`**/v1/orders/${id}/offer`, (route) => { decided = route.request().postDataJSON(); return route.fulfill({ json: { status: "accepted" } }); });
  await page.route(`**/v1/orders/${id}/confirmation`, (route) => route.fulfill({ json: {
    run: { id: "88888888-8888-4888-8888-888888888888", status: "needs_agent", outcome: null, reason: "team_call", answeredChannel: null, plan: [], step: 1, startedAt: at, finishedAt: null, linkExpiresAt: at, next: null, calls: { attempts: 0, max: 3, after: null } },
    steps: [], attempts: [], whatsapp: [], script: ["أهلاً منى، معاك فريق المتجر."], channels: { whatsapp: true, call_auto: false, call_team: true },
    offer: { id: "99999999-9999-4999-8999-999999999999", title: "طرحة مطابقة", qty: 1, unitPrice: egp("150.00"), offerPrice: egp("135.00"), discountPct: "10", source: "rule", status: "proposed", messageAr: null, messageEn: null },
  } }));
  await page.goto(`/ar/orders/${id}`);
  const box = page.getByRole("main").getByTestId("offer-box");
  await expect(box).toContainText("طرحة مطابقة");
  await expect(box).toContainText("معروض");
  await expect(box).toContainText("من قاعدة بتاعتك");
  await box.getByRole("button", { name: "العميل وافق" }).click();
  await expect(page.locator(".mz-toast")).toContainText("اتسجّل إن العميل وافق على العرض");
  expect(decided).toEqual({ decision: "accept" });
});
