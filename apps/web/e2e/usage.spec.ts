import { expect, test } from "@playwright/test";
import { mizan, ownerWithStore, signInOwner } from "./stack";

/** E12-3 in the browser: this month's orders, stores and users against the Free plan's limits. */
test("owner in Arabic: sees this month's usage against the plan", async ({ page }) => {
  const owner = await ownerWithStore("متجر الاستخدام");
  await mizan(owner.token, "POST", "/orders", {
    source: "phone", customer: { name: "منى عادل", phone: "01001234821" }, address: { line1: "12 شارع عباس العقاد", city: "مدينة نصر" },
    lines: [{ title: "عباية سادة", quantity: 1, unitPrice: "1000" }], shipping: "0", payment: { mode: "cod" },
  }, owner.storeId);
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await page.goto("/ar/settings/usage");
  const usage = page.getByTestId("usage");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("الباقة والاستخدام");
  await expect(usage).toContainText("مجانية");
  await expect(usage).toContainText("أوردرات الشهر");
  await expect(usage).toContainText("1 من 300");
  await expect(usage).toContainText("1 من 2"); // team members
  await expect(page.getByRole("table", { name: "آخر ست شهور" }).getByRole("row")).toHaveCount(7);
});
