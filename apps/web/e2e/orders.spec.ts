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
