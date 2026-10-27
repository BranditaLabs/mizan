import { expect, test } from "@playwright/test";
import { mizan, newPhone, ownerWithStore, phoneUser, signInOwner } from "./stack";

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

/** E12-1: at the plan's user limit the dashboard says so (once per visit), and the owner asks for Growth. */
test("owner in Arabic: the plan banner, hidden for the visit, and an upgrade request", async ({ page }) => {
  const owner = await ownerWithStore("متجر الحدود");
  const phone = newPhone();
  const inv = await mizan<{ id: string }>(owner.token, "POST", "/members/invite", { phone: phone.e164, role: "agent" }, owner.storeId);
  await mizan(await phoneUser(phone.e164), "POST", `/invitations/${inv.id}/accept`);

  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  const banner = page.getByTestId("plan-banner");
  await expect(banner).toContainText("أعضاء الفريق: 2 من 2 في باقة المجانية");
  await banner.getByRole("button", { name: "اخفي" }).click();
  await expect(banner).toHaveCount(0);
  await page.goto("/ar/orders");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByTestId("plan-banner")).toHaveCount(0); // hidden for this visit

  await page.goto("/ar/settings/usage");
  const upgrade = page.getByTestId("upgrade");
  await expect(upgrade).toContainText("انقل لباقة النمو");
  await expect(upgrade).toContainText("3000 أوردر في الشهر");
  await upgrade.getByRole("button", { name: "اطلب باقة النمو" }).click();
  await expect(page.locator(".mz-toast", { hasText: "الطلب اتبعت. هنكلمك." })).toBeVisible();
  await expect(upgrade).toContainText("طلبت باقة النمو يوم");
});
