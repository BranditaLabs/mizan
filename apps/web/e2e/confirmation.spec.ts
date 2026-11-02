import { expect, test } from "@playwright/test";
import { ownerWithStore, signInOwner } from "./stack";

/**
 * E6-7 automated confirmation in the browser. The cascade, the link's rules and the order status
 * changes run in the API's confirmation e2e; this stack has no store orders, so the link page and
 * the order card are served by the test (shapes from the OpenAPI contract), and settings and an
 * invalid link hit the real API.
 */
const TOKEN = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const egp = (amount: string) => ({ amount, currency: "EGP" });
const view = (state: string) => ({
  store: "متجر النيل", state, firstName: "منى",
  order: { number: "#7001", items: [{ title: "عباية سادة", quantity: 2 }], total: egp("1250.00"), cod: egp("1250.00"), city: "مدينة نصر" },
  hasLocation: false, expiresAt: "2026-10-26T09:00:00.000Z",
});

test("customer in Arabic: sees the order and confirms with one tap, no sign-in", async ({ page }) => {
  const answers: unknown[] = [];
  await page.route(`**/v1/public/confirm/${TOKEN}`, (route) => {
    if (route.request().method() === "POST") { answers.push(route.request().postDataJSON()); return route.fulfill({ json: view("confirmed") }); }
    return route.fulfill({ json: view("open") });
  });
  await page.goto(`/ar/c/${TOKEN}`);
  const main = page.getByRole("main");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("أهلاً منى");
  await expect(main).toContainText("عباية سادة");
  await expect(main).toContainText("هتدفع عند الاستلام");
  await expect(main).toContainText("التوصيل لـ مدينة نصر");
  await main.getByRole("button", { name: "أكّد الأوردر" }).click();
  await expect(main.getByTestId("confirm-done")).toContainText("الأوردر اتأكّد");
  await expect(main.getByTestId("confirm-done")).toContainText("شكراً! متجر النيل هيشحن أوردرك قريب.");
  expect(answers).toEqual([{ answer: "confirm" }]);
});

test("customer asks for a change, or cancels with a reason", async ({ page }) => {
  const answers: Array<{ answer: string }> = [];
  await page.route(`**/v1/public/confirm/${TOKEN}`, (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { answer: string };
      answers.push(body);
      return route.fulfill({ json: view(body.answer === "change" ? "changed" : "cancelled") });
    }
    return route.fulfill({ json: view("open") });
  });
  await page.goto(`/ar/c/${TOKEN}`);
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "عايز أعدّل" }).click();
  await main.getByLabel("عايز تعدّل إيه؟").fill("المقاس L لو سمحت");
  await main.getByRole("button", { name: "ابعت" }).click();
  await expect(main.getByTestId("confirm-done")).toContainText("طلبك وصل");
  expect(answers.at(-1)).toEqual({ answer: "change", note: "المقاس L لو سمحت" });

  await page.goto(`/en/c/${TOKEN}`);
  await main.getByRole("button", { name: "Cancel order" }).click();
  await main.getByLabel("Why are you cancelling?").selectOption("ordered_by_mistake");
  await main.getByRole("button", { name: "Cancel the order" }).click();
  await expect(main.getByTestId("confirm-done")).toContainText("Order cancelled");
  expect(answers.at(-1)).toEqual({ answer: "cancel", reason: "ordered_by_mistake" });
});

test("a broken link says so (real API)", async ({ page }) => {
  await page.goto("/ar/c/not-a-real-token");
  await expect(page.getByRole("main").getByTestId("confirm-done")).toContainText("اللينك ده مش شغال");
});

test("owner in Arabic: Settings → Confirmation shows no channel connected and saves the switch", async ({ page }) => {
  const owner = await ownerWithStore("متجر التأكيد");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await page.getByRole("link", { name: "الإعدادات" }).click();
  await page.getByRole("main").getByRole("link", { name: "التأكيد" }).click();
  await expect(page).toHaveURL(/\/ar\/settings\/confirmation$/);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("التأكيد");
  await expect(main.getByTestId("confirmation-channels")).toContainText("واتساب · مش متوصّل");
  await expect(main.getByTestId("confirmation-channels")).toContainText("فريقنا يكلّم العميل · متاح دايماً");
  await expect(main).toContainText("واتساب مش متوصّل لسه");
  // The WhatsApp connect form (owner): ids from Meta and a token, shown as a password field.
  const wa = main.getByTestId("whatsapp-connect");
  await expect(wa.getByLabel("معرّف الرقم (Phone number ID)")).toBeVisible();
  await expect(wa.getByLabel("التوكن الدائم")).toHaveAttribute("type", "password");
  const toggle = main.getByRole("switch", { name: /أكّد الأوردرات الجديدة/ });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  // Routing by risk (E6-2): off by default; on, three thresholds that must go up.
  const routing = main.getByTestId("routing");
  await routing.getByRole("switch", { name: /وجّه كل أوردر/ }).check();
  await routing.getByLabel("أكّد من غير ما تسأل لحد").fill("70");
  await expect(routing).toContainText("كل رقم لازم يكون أكبر من أو يساوي اللي قبله");
  await expect(main.getByRole("button", { name: "احفظ" })).toBeDisabled();
  await routing.getByLabel("أكّد من غير ما تسأل لحد").fill("20");
  await main.getByRole("button", { name: "احفظ" }).click();
  await expect(page.locator(".mz-toast")).toContainText("اتحفظ");
  await page.reload();
  await expect(main.getByRole("switch", { name: /أكّد الأوردرات الجديدة/ })).not.toBeChecked();
  await expect(main.getByTestId("routing").getByRole("switch", { name: /وجّه كل أوردر/ })).toBeChecked();
  await expect(main.getByTestId("routing").getByLabel("أكّد من غير ما تسأل لحد")).toHaveValue("20");
});

test("owner: confirmation results by route and channel, Arabic and English (E6-6)", async ({ page }) => {
  const owner = await ownerWithStore("متجر النتايج");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await page.goto("/ar/settings/confirmation");
  const results = page.getByRole("main").getByTestId("confirmation-results");
  await expect(results).toContainText("لسه مفيش أوردرات عدّت على التأكيد"); // the real API: a new store
  await page.route("**/v1/confirmation/summary?days=*", (route) => route.fulfill({ json: {
    days: Number(new URL(route.request().url()).searchParams.get("days")), orders: 7, confirmed: 5, cancelled: 1, pending: 1, rate: "83.3", needsTeam: 1, medianMinutes: 95,
    byRoute: [
      { route: "auto", orders: 2, confirmed: 2, cancelled: 0, pending: 0, rate: "100.0" },
      { route: "bot", orders: 4, confirmed: 2, cancelled: 1, pending: 1, rate: "66.7" },
      { route: "agent", orders: 1, confirmed: 1, cancelled: 0, pending: 0, rate: "100.0" },
    ],
    byChannel: [{ channel: "auto", confirmed: 2, cancelled: 0 }, { channel: "whatsapp", confirmed: 2, cancelled: 1 }, { channel: "call_team", confirmed: 1, cancelled: 0 }],
  } }));
  await results.getByRole("button", { name: "آخر 7 يوم" }).click();
  await expect(results).toContainText("83.3٪");
  await expect(results).toContainText("1:35ساعة");
  await expect(results.getByTestId("results-by-route")).toContainText("اتسألوا في الشات");
  await expect(results.getByTestId("results-by-route")).toContainText("66.7٪");
  await expect(results.getByTestId("results-by-channel")).toContainText("2 اتأكّدوا · 1 اتلغوا");
  await page.setViewportSize({ width: 1280, height: 1400 });
  await results.screenshot({ path: "test-results/confirmation-results-ar.png" });
  await page.goto("/en/settings/confirmation");
  const en = page.getByRole("main").getByTestId("confirmation-results");
  await expect(en).toContainText("Confirmation rate");
  await expect(en).toContainText("83.3%");
  await expect(en.getByTestId("results-by-route")).toContainText("Confirmed without asking");
  await expect(en.getByTestId("results-by-channel")).toContainText("Our team's call");
});

test("order detail: the team's call panel with the script, the WhatsApp conversation, and the hand-sent link", async ({ page }) => {
  const owner = await ownerWithStore("متجر الكارت");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  const id = "44444444-4444-4444-8444-444444444444";
  const at = "2026-10-23T09:00:00.000Z";
  await page.route(`**/v1/orders/${id}`, (route) => route.fulfill({ json: {
    id, number: "#7002", externalId: null, status: "pending_confirmation", channel: "store", store: { connectionId: null, provider: "shopify" },
    customer: { label: "منى ع.", phoneLast4: "4821" }, currency: "EGP", total: egp("1250.00"), cod: egp("1250.00"), subtotal: egp("1200.00"), shipping: egp("50.00"),
    discount: egp("0.00"), paid: egp("0.00"), refunded: egp("0.00"), balance: egp("1250.00"), paymentMode: "cod", paymentStatus: "unpaid", risk: null, riskReasons: [], tags: [],
    assignedTo: null, area: { city: "مدينة نصر", province: null, country: "EG" }, hasLocation: false, redacted: false, placedAt: at,
    timestamps: { placedAt: at, confirmedAt: null, shippedAt: null, deliveredAt: null, cancelledAt: null }, lines: [], payments: [], shipments: [],
    events: [{ id: "55555555-5555-4555-8555-555555555555", type: "confirmation_escalated", fromStatus: null, toStatus: null, actorType: "system", at, data: { reason: "team_call" } }],
  } }));
  await page.route(`**/v1/orders/${id}/confirmation`, (route) => route.fulfill({ json: {
    run: { id: "66666666-6666-4666-8666-666666666666", status: "needs_agent", outcome: null, reason: "team_call", answeredChannel: null, plan: [], step: 1, startedAt: at, finishedAt: null, linkExpiresAt: "2026-10-26T09:00:00.000Z", next: null, calls: { attempts: 1, max: 3, after: null } },
    steps: [{ idx: 0, channel: "whatsapp", status: "done", at }, { idx: 1, channel: "call_team", status: "done", at }], attempts: [],
    whatsapp: [
      { direction: "out", kind: "template", action: "ask", status: "read", errorCode: null, at },
      { direction: "in", kind: "text", action: "message", status: "received", errorCode: null, at },
    ],
    script: ["أهلاً منى، معاك فريق متجر الكارت.", "بنأكّد أوردرك رقم #7002: عباية سادة × 2.", "الإجمالي 1,250 ج.م. عند الاستلام."],
    channels: { whatsapp: false, call_auto: false, call_team: true },
  } }));
  let noAnswer = 0;
  await page.route(`**/v1/orders/${id}/confirmation/no-answer`, (route) => { noAnswer++; return route.fulfill({ json: { attempts: 2, max: 3, after: "2026-10-23T11:00:00.000Z", unreachable: false } }); });
  await page.goto(`/ar/orders/${id}`);
  const card = page.getByRole("main").getByTestId("confirmation-card");
  await expect(card).toContainText("العميل مردّش على واتساب. كلّمه.");
  await expect(card.getByTestId("confirmation-chat")).toContainText("اتبعت طلب التأكيد · اتقرت");
  await expect(card.getByTestId("confirmation-chat")).toContainText("العميل كتب رسالة");
  const panel = card.getByTestId("call-panel");
  await expect(panel).toContainText("اتصلنا 1 من 3");
  await expect(panel.getByTestId("call-script")).toContainText("بنأكّد أوردرك رقم #7002: عباية سادة × 2.");
  await expect(panel.getByRole("button", { name: "العميل أكّد" })).toBeVisible();
  await panel.getByRole("button", { name: "مردّش" }).click();
  await expect(page.locator(".mz-toast")).toContainText("هيرجع للقايمة");
  expect(noAnswer).toBe(1);
  // Without a WhatsApp number the link can still be sent by hand.
  await expect(card.getByRole("button", { name: "ابعت على واتساب" })).toBeVisible();
  await expect(card).toContainText("واتساب مش متوصّل لسه");
  await expect(page.getByRole("main")).toContainText("اتحوّل لموظف");
});
