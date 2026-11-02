import { expect, test } from "@playwright/test";
import { agentIn, newPhone, ownerWithStore, signInOwner, signInWithPhone } from "./stack";

/**
 * E11-2 in the browser, against the real API: install a recipe (an editable copy, off), turn it
 * on, read its (empty) run log. The bell's list is served by the test, since this stack has no
 * products or orders to raise a real alert; runs and notifications are covered in apps/api.
 */
test("owner in Arabic: installs a recipe, turns it on, opens its run log; the bell shows what's new", async ({ page }) => {
  const owner = await ownerWithStore("متجر الأتمتة");
  let read = false;
  await page.route("**/v1/notifications?*", (route) => route.fulfill({ json: {
    data: [{ id: "99999999-9999-4999-8999-999999999999", at: "2026-10-26T10:00:00.000Z", text: "BAG-TT قرب يخلص: فاضل 4", source: "automation:x", entity: { type: "variant", id: "88888888-8888-4888-8888-888888888888" }, read }],
    unread: read ? 0 : 1,
  } }));
  await page.route("**/v1/notifications/read", (route) => { read = true; return route.fulfill({ json: { marked: 1 } }); });

  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);

  // The bell: one new, opening it shows the alert and marks it read.
  await expect(page.getByTestId("notification-count")).toHaveText("1");
  await page.getByRole("button", { name: "التنبيهات، 1 جديدة" }).click();
  const panel = page.getByTestId("notifications");
  await expect(panel).toContainText("BAG-TT قرب يخلص: فاضل 4");
  await expect(panel.getByRole("link")).toHaveAttribute("href", "/ar/stock");
  await expect.poll(() => read).toBe(true);
  await page.keyboard.press("Escape");

  await page.getByRole("link", { name: "الأتمتة" }).click();
  await expect(page).toHaveURL(/\/ar\/automations$/);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("الأتمتة");
  await expect(main.getByText("لسه مفيش أتمتة")).toBeVisible();

  const recipe = main.getByTestId("recipes").getByRole("listitem").filter({ hasText: "تنبيه المخزون القليل" });
  await expect(recipe).toContainText("لما منتج يقرب يخلص");
  await recipe.getByRole("button", { name: "ثبّت" }).click();
  await expect(page.locator(".mz-toast", { hasText: "اتثبّتت \"تنبيه المخزون القليل\"" })).toBeVisible();
  await expect(recipe).toContainText("متثبّتة");

  const mine = main.getByTestId("my-automations");
  const sw = mine.getByRole("switch", { name: /تنبيه المخزون القليل/ });
  await expect(sw).not.toBeChecked();
  await sw.click();
  await expect(page.locator(".mz-toast", { hasText: "\"تنبيه المخزون القليل\" اشتغلت" })).toBeVisible();
  await expect(sw).toBeChecked();

  await mine.getByRole("button", { name: "سجل التشغيل" }).click();
  await expect(page.getByRole("dialog", { name: "سجل التشغيل · تنبيه المخزون القليل" })).toContainText("لسه مفيش تشغيلات");
});

test("an agent cannot manage automations", async ({ page }) => {
  const phone = newPhone();
  await agentIn(phone, "Agents Auto Store");
  await page.goto("/en/sign-in");
  await signInWithPhone(page, phone, "en");
  await expect(page.getByTestId("store-name")).toHaveText("Agents Auto Store");
  await page.goto("/en/automations");
  await expect(page.getByRole("main").getByText("Not available for your role")).toBeVisible();
});
