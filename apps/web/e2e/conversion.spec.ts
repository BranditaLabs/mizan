import { expect, test } from "@playwright/test";
import { mizan, ownerWithStore, signInOwner } from "./stack";

/**
 * E14-3 in the browser, against the real API: a COD order with nowhere to pay points to
 * Settings → Payments; once InstaPay is set, the owner offers a deposit, gets the message to send,
 * records the payment and the offer closes. Rules and the courier's review are in apps/api.
 */
test("owner in Arabic: sets InstaPay, offers a deposit, the payment closes the offer", async ({ page }) => {
  const owner = await ownerWithStore("متجر العربون");
  const order = await mizan<{ id: string; number: string }>(owner.token, "POST", "/orders", {
    source: "phone", customer: { name: "منى عادل", phone: "01001234931" }, address: { line1: "12 شارع عباس العقاد", city: "مدينة نصر" },
    lines: [{ title: "عباية سادة", quantity: 1, unitPrice: "1000" }], shipping: "0", payment: { mode: "cod" },
  }, owner.storeId);

  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await page.goto(`/ar/orders/${order.id}`);
  const card = page.getByTestId("order-conversion");
  await expect(card).toContainText("حدد الأول العميل يدفع فين:");
  await card.getByRole("link", { name: "الإعدادات ← المدفوعات" }).click();

  await expect(page).toHaveURL(/\/ar\/settings\/payments$/);
  await page.getByLabel("إنستاباي").fill("nile@instapay");
  await page.getByLabel("العربون (% من المطلوب)").fill("20");
  await page.getByRole("button", { name: "احفظ" }).click();
  await expect(page.locator(".mz-toast", { hasText: "اتحفظت" })).toBeVisible();

  await page.goto(`/ar/orders/${order.id}`);
  await expect(card.getByLabel("العربون")).toHaveAttribute("placeholder", "200.00");
  await card.getByRole("button", { name: "اعمل العرض" }).click();
  await expect(page.locator(".mz-toast", { hasText: "العرض جاهز: ابعت الرسالة" })).toBeVisible();
  await expect(card).toContainText("مستني الدفع");
  await expect(page.getByTestId("conversion-message")).toContainText("nile@instapay");
  await expect(page.getByTestId("conversion-message")).toContainText("200.00 ج.م.");

  await page.getByRole("button", { name: "سجّل دفعة" }).click();
  const d = page.getByRole("dialog", { name: "تسجيل دفعة" });
  await d.getByLabel("طريقة الدفع").selectOption("instapay");
  await d.getByLabel("المبلغ (EGP)").fill("200");
  await d.getByRole("button", { name: "سجّل", exact: true }).click();
  await expect(card).toContainText("اتدفع");
  await expect(page.getByTestId("conversion-message")).toHaveCount(0);
  await card.screenshot({ path: "test-results/conversion-ar.png" });
});
