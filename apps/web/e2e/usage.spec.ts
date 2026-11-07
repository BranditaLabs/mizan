import { expect, test } from "@playwright/test";
import { endTrial, mizan, newPhone, ownerWithStore, phoneUser, signInOwner } from "./stack";

/**
 * E12-3 in the browser: this month's orders, stores and users against the plan's limits. A new
 * store is on its 7-day Growth trial (E12-2a2): the banner and the subscription card say so.
 */
test("owner in Arabic: sees this month's usage against the trial's plan", async ({ page }) => {
  const owner = await ownerWithStore("متجر الاستخدام");
  await mizan(owner.token, "POST", "/orders", {
    source: "phone", customer: { name: "منى عادل", phone: "01001234821" }, address: { line1: "12 شارع عباس العقاد", city: "مدينة نصر" },
    lines: [{ title: "عباية سادة", quantity: 1, unitPrice: "1000" }], shipping: "0", payment: { mode: "cod" },
  }, owner.storeId);
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await expect(page.getByTestId("trial-banner")).toContainText("فاضل 7 أيام في تجربة باقة النمو");
  await page.goto("/ar/settings/usage");
  const usage = page.getByTestId("usage");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("الباقة والاستخدام");
  const sub = page.getByTestId("subscription");
  await expect(sub).toContainText("باقتك: النمو");
  await expect(sub).toContainText("تجربة");
  await expect(sub).toContainText("فاضل 7 أيام");
  await expect(usage).toContainText("النمو");
  await expect(usage).toContainText("أوردرات الشهر");
  await expect(usage).toContainText(/1 من 3[,٬]?000/);
  await expect(usage).toContainText("1 من 8"); // team members
  await expect(page.getByRole("table", { name: "آخر ست شهور" }).getByRole("row")).toHaveCount(7);
  await expect(page.getByTestId("upgrade")).toContainText("انقل لباقة التوسّع"); // the next plan after the trial's
});

/** E12-1: at the plan's user limit the dashboard says so (once per visit), and the owner asks for Growth. On Free: the trial is over. */
test("owner in Arabic: the plan banner, hidden for the visit, and an upgrade request", async ({ page }) => {
  const owner = await ownerWithStore("متجر الحدود");
  await endTrial(owner.storeId);
  const phone = newPhone();
  const inv = await mizan<{ id: string }>(owner.token, "POST", "/members/invite", { phone: phone.e164, role: "agent" }, owner.storeId);
  await mizan(await phoneUser(phone.e164), "POST", `/invitations/${inv.id}/accept`);

  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await expect(page.getByTestId("trial-banner")).toHaveCount(0);
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
