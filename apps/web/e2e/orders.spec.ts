import { expect, test } from "@playwright/test";
import { agentIn, newPhone, ownerWithStore, signInOwner, signInWithPhone } from "./stack";

/**
 * E5-1 order list in the browser. The rows themselves (masking, filters, search, pages, role scope)
 * are covered by the API's orders-list e2e; this stack has no store to import from, so here: the
 * screen in both languages, tabs with counts, the empty states, and the URL keeping the view.
 */

test("owner in Arabic: sidebar link → empty list with counts and a link to setup; search and tab kept in the URL", async ({ page }) => {
  const owner = await ownerWithStore("متجر النيل");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);

  await page.getByRole("link", { name: "الأوردرات" }).click();
  await expect(page).toHaveURL(/\/ar\/orders$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("الأوردرات");

  const tabs = main.getByRole("tablist", { name: "حالة الأوردر" });
  await expect(tabs.getByRole("tab", { name: "الكل" })).toHaveAttribute("aria-selected", "true");
  await expect(tabs.getByRole("tab", { name: "الكل" })).toContainText("0");
  await expect(main.getByText("مفيش أوردرات لسه")).toBeVisible();
  await expect(main.getByRole("link", { name: "جهّز متجرك" })).toHaveAttribute("href", "/ar/onboarding");

  await tabs.getByRole("tab", { name: /متأكد/ }).click();
  await expect(page).toHaveURL(/\/ar\/orders\?status=confirmed$/);
  await main.getByRole("searchbox", { name: "دوّر برقم الأوردر أو موبايل العميل" }).fill("#1042");
  await expect(page).toHaveURL(/status=confirmed&q=%231042$/);
  await expect(main.getByText("مفيش أوردر مطابق")).toBeVisible();

  // A shared link opens the same view.
  await page.reload();
  await expect(tabs.getByRole("tab", { name: /متأكد/ })).toHaveAttribute("aria-selected", "true");
  await expect(main.getByRole("searchbox")).toHaveValue("#1042");
});

test("agent in English: their own queue, no setup link", async ({ page }) => {
  const phone = newPhone();
  await agentIn(phone, "Agents Orders Store");
  await page.goto("/en/sign-in");
  await signInWithPhone(page, phone, "en");
  await expect(page.getByTestId("store-name")).toHaveText("Agents Orders Store");

  await page.goto("/en/orders");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Orders");
  await expect(main.getByText("No orders yet")).toBeVisible();
  await expect(main.getByRole("link", { name: "Set up your store" })).toHaveCount(0);
});

test("order detail in Arabic: an unknown order says so and links back to the list", async ({ page }) => {
  const owner = await ownerWithStore("متجر الدلتا");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await page.goto("/ar/orders/00000000-0000-4000-8000-000000000000");
  const main = page.getByRole("main");
  await expect(main.getByText("الأوردر مش موجود")).toBeVisible();
  await main.getByRole("link", { name: "كل الأوردرات" }).click();
  await expect(page).toHaveURL(/\/ar\/orders$/);
});

/**
 * The browser stack has no store to import from, so this order is served by the test (shapes
 * from the OpenAPI contract); the API side of detail and reveal runs in apps/api's order-detail e2e.
 */
test("order detail in Arabic: masked customer, money, timeline; showing details asks the API once", async ({ page }) => {
  const owner = await ownerWithStore("متجر الصعيد");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);

  const id = "11111111-1111-4111-8111-111111111111";
  const egp = (amount: string) => ({ amount, currency: "EGP" });
  const at = "2026-10-21T09:01:00.000Z";
  await page.route(`**/v1/orders/${id}`, (route) => route.fulfill({ json: {
    id, number: "#7001", externalId: "gid://shopify/Order/7001", status: "pending_confirmation", channel: "store",
    store: { connectionId: null, provider: "shopify" }, customer: { label: "منى ع.", phoneLast4: "4821" },
    currency: "EGP", total: egp("1250.00"), cod: egp("1250.00"), subtotal: egp("1200.00"), shipping: egp("50.00"), discount: egp("0.00"),
    paid: egp("0.00"), refunded: egp("0.00"), balance: egp("1250.00"), paymentMode: "cod", paymentStatus: "unpaid",
    risk: 64, riskReasons: ["new_customer"], tags: [], assignedTo: null, area: { city: "مدينة نصر", province: "القاهرة", country: "EG" },
    hasLocation: true, redacted: false, placedAt: at,
    timestamps: { placedAt: at, confirmedAt: null, shippedAt: null, deliveredAt: null, cancelledAt: null },
    lines: [{ id: "22222222-2222-4222-8222-222222222222", sku: "AB-1", title: "عباية سادة", quantity: 2, unitPrice: egp("600.00"), total: egp("1200.00"), variantId: null }],
    payments: [], shipments: [],
    events: [{ id: "33333333-3333-4333-8333-333333333333", type: "created", fromStatus: null, toStatus: "new", actorType: "system", at, data: { source: "shopify" } }],
  } }));
  let reveals = 0;
  await page.route(`**/v1/orders/${id}/reveal`, (route) => {
    reveals++;
    return route.fulfill({ json: {
      name: "منى عادل", phone: "+201001234821",
      address: { line1: "12 شارع عباس العقاد", line2: null, city: "مدينة نصر", province: "القاهرة", country: "EG" },
      location: { lat: 30.0561, lng: 31.3301 },
    } });
  });

  await page.goto(`/ar/orders/${id}`);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("#7001");
  await expect(main.getByText("مستني التأكيد").first()).toBeVisible();
  await expect(main.getByText("المندوب هيحصّل")).toBeVisible();
  await expect(main.getByText("الأوردر وصل من Shopify")).toBeVisible();
  await expect(main.getByText("••• 4821")).toBeVisible();
  await expect(main.getByText("منى عادل")).toHaveCount(0);

  await main.getByRole("button", { name: "اعرض البيانات" }).click();
  const shown = main.getByTestId("customer-revealed");
  await expect(shown).toContainText("منى عادل");
  await expect(shown).toContainText("+201001234821");
  await expect(shown.getByRole("link", { name: "افتح على خرائط جوجل" })).toHaveAttribute("href", "https://www.google.com/maps?q=30.0561,31.3301");
  expect(reveals).toBe(1);
  await main.getByRole("button", { name: "اخفي" }).click();
  await expect(main.getByText("منى عادل")).toHaveCount(0);
});
