import { expect, test } from "@playwright/test";
import { mizan, ownerWithStore, signInOwner } from "./stack";

/**
 * E5-4 bulk actions in the browser, against the real API and its in-process worker: three orders
 * typed by hand are selected and cancelled together; the progress panel follows to the end.
 * Chunks, Shopify cancellation and every skip reason run in the API's bulk-actions e2e.
 */
test("owner in Arabic: selects three orders and cancels them together", async ({ page }) => {
  const owner = await ownerWithStore("متجر الجملة");
  const numbers: string[] = [];
  for (const phone of ["01001112221", "01001112222", "01001112223"]) {
    const o = await mizan<{ number: string }>(owner.token, "POST", "/orders", {
      source: "phone", customer: { name: "منى عادل", phone }, address: { line1: "12 شارع عباس العقاد", city: "مدينة نصر" },
      lines: [{ title: "عباية سادة", quantity: 1, unitPrice: "1150" }], payment: { mode: "cod" },
    }, owner.storeId);
    numbers.push(o.number);
  }
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await page.goto("/ar/orders");
  const main = page.getByRole("main");
  await expect(main).toContainText(numbers[2]!);

  await main.getByRole("checkbox", { name: "اختار كل الصفوف" }).check();
  const bar = main.getByRole("region", { name: "إجراءات على الصفوف المختارة" });
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "ألغي", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("ألغي 3 أوردرات");
  await dialog.getByLabel("السبب").selectOption("customer_cancelled");
  await dialog.getByRole("button", { name: "ألغي الأوردرات" }).click();

  const progress = main.getByTestId("bulk-progress");
  await expect(progress).toContainText("الإلغاء خلص", { timeout: 15_000 });
  await expect(progress).toContainText("3 اتعمل · 0 اتعدّى · 0 فشل من 3");
  await page.setViewportSize({ width: 1280, height: 900 });
  await main.screenshot({ path: "test-results/bulk-ar.png" });
  await page.goto(`/ar/orders?status=cancelled`);
  for (const n of numbers) await expect(main).toContainText(n);
});
