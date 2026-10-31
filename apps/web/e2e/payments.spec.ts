import { expect, test } from "@playwright/test";
import { mizan, ownerWithStore, signInOwner } from "./stack";

/**
 * E14-6 in the browser, against the real API: orders by where their money stands, the view's
 * sums, and the payment mix on the home screen. The views' rules run in apps/api.
 */
test("owner in Arabic: sees what is waiting for money and the cash still to collect, and the mix at home", async ({ page }) => {
  const owner = await ownerWithStore("متجر المدفوعات");
  const place = (payment: object) => mizan<{ id: string; number: string }>(owner.token, "POST", "/orders", {
    source: "phone", customer: { name: "منى عادل", phone: "01001234821" }, address: { line1: "12 شارع عباس العقاد", city: "مدينة نصر" },
    lines: [{ title: "عباية سادة", quantity: 1, unitPrice: "1000" }], shipping: "0", payment,
  }, owner.storeId);
  const cod = await place({ mode: "cod" });
  const transfer = await place({ mode: "bank_transfer" });
  await place({ mode: "partial", method: "instapay", paid: "250" });

  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await expect(page.getByTestId("payment-mix")).toContainText("العملاء دفعوا إزاي");
  await expect(page.getByTestId("payment-mix")).toContainText("إنستاباي");

  await page.getByRole("navigation", { name: "القايمة الرئيسية" }).getByRole("link", { name: "المدفوعات" }).click();
  await expect(page).toHaveURL(/\/ar\/payments$/);
  const screen = page.getByTestId("payments");
  await expect(screen.getByRole("tab", { name: /الكل/ })).toContainText("3");

  await screen.getByRole("tab", { name: /مستني فلوس/ }).click();
  await expect(screen.getByRole("row", { name: new RegExp(transfer.number) })).toContainText("تحويل بنكي");
  await expect(screen.getByRole("row")).toHaveCount(2); // header + the transfer

  await screen.getByRole("tab", { name: /كاش هيتحصّل/ }).click();
  await expect(screen.getByRole("row", { name: new RegExp(cod.number) })).toBeVisible();
  await expect(screen.getByTestId("payment-totals")).toContainText("1,750.00");
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.screenshot({ path: "test-results/payments-ar.png", fullPage: true });
});
