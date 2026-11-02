import { expect, test } from "@playwright/test";
import { mizan, ownerWithStore, signInOwner } from "./stack";

/**
 * E14-4 in the browser, against the real API: a refund over the store's threshold waits for
 * approval, is approved, then recorded as sent; one still open shows on the payments screen.
 * The rules (four eyes, destinations, store refunds) run in apps/api.
 */
test("owner in Arabic: asks for a refund, approves it, records it sent; the open one waits on the payments screen", async ({ page }) => {
  const owner = await ownerWithStore("متجر الاسترجاع");
  const order = await mizan<{ id: string; number: string }>(owner.token, "POST", "/orders", {
    source: "phone", customer: { name: "منى عادل", phone: "01001234821" }, address: { line1: "12 شارع عباس العقاد", city: "مدينة نصر" },
    lines: [{ title: "عباية سادة", quantity: 1, unitPrice: "1000" }], shipping: "0", payment: { mode: "bank_transfer" },
  }, owner.storeId);
  await mizan(owner.token, "POST", `/orders/${order.id}/payments`, { type: "received", method: "bank_transfer", amount: "1000" }, owner.storeId);
  await mizan(owner.token, "PUT", "/settings/refunds", { approveOver: "100" }, owner.storeId);

  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await page.goto(`/ar/orders/${order.id}`);
  const card = page.getByTestId("order-refunds");
  await expect(card).toContainText("مفيش استرجاع فلوس على الأوردر ده.");

  await page.getByRole("button", { name: "رجّع فلوس" }).click();
  const dialog = page.getByRole("dialog", { name: "ترجيع فلوس للعميل" });
  await expect(dialog.getByLabel("المبلغ (EGP)")).toHaveValue("1000.00");
  await dialog.getByLabel("المبلغ (EGP)").fill("300");
  await dialog.getByLabel("يرجع على").selectOption("bank_transfer");
  await dialog.getByLabel("السبب").fill("المقاس طلع صغير");
  await dialog.getByRole("button", { name: "رجّع فلوس" }).click();
  await expect(page.locator(".mz-toast", { hasText: "R-1001 مستنية موافقة" })).toBeVisible();
  const refund = card.getByTestId("refund");
  await expect(refund).toContainText("مستنية موافقة");

  await refund.getByRole("button", { name: "وافق" }).click();
  await expect(refund).toContainText("اتوافق عليها");
  await refund.getByRole("button", { name: "اتبعتت" }).click();
  const sent = page.getByRole("dialog", { name: "R-1001 اتبعتت" });
  await sent.getByLabel("رقم العملية").fill("CIB-55102");
  await sent.getByRole("button", { name: "اتبعتت" }).click();
  await expect(refund).toContainText("الفلوس رجعت");
  await expect(refund).toContainText("CIB-55102");
  await expect(page.getByTestId("ledger")).toContainText("-300.00");
  await page.setViewportSize({ width: 1280, height: 1600 });
  await page.screenshot({ path: "test-results/refunds-ar.png", fullPage: true });

  // Another one waits for approval: it shows on the payments screen.
  await mizan(owner.token, "POST", `/orders/${order.id}/refunds`, { amount: "150", destination: "cash" }, owner.storeId);
  await page.goto("/ar/payments");
  const queue = page.getByTestId("refund-queue");
  await expect(queue).toContainText("R-1002");
  await expect(queue).toContainText(order.number);
  await expect(page.getByRole("main")).toContainText("استرجاعات محتاجة شغل · 1");

  await page.goto("/ar/settings/refunds");
  await expect(page.getByTestId("refund-settings").getByRole("textbox")).toHaveValue("100");
});
