import { expect, test } from "@playwright/test";
import { agentIn, mizan, newPhone, ownerWithStore, signInOwner, signInWithPhone } from "./stack";

/**
 * E4-5 setup screens in the browser. The full connect → import → costs → courier flow runs in the
 * API's onboarding e2e (fake Shopify and Bosta); here: what the owner sees and can do in both
 * languages, the Shopify callback page, the setup card, and that other roles never see setup.
 */

test("owner in Arabic: setup card on home → wizard; steps wait for the store; Shopify errors explained", async ({ page }) => {
  const owner = await ownerWithStore("متجر الصعيد");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);

  const card = page.getByTestId("setup-card");
  await expect(card).toContainText("كمّل تجهيز ميزان");
  await expect(card).toContainText("خلصت 0 من 4 خطوات. الجاية: اربط متجر شوبيفاي.");
  await card.getByRole("link", { name: "كمّل التجهيز" }).click();
  await expect(page).toHaveURL(/\/ar\/onboarding$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("جهّز متجرك");
  await expect(page.getByTestId("onboarding-progress")).toHaveText("خلصت 0 من 4");

  // Courier and costs wait for the store.
  const steps = page.getByRole("navigation", { name: "خطوات التجهيز" });
  await expect(steps.getByRole("button", { name: /اربط شركة الشحن/ })).toContainText("بعد المتجر");
  await steps.getByRole("button", { name: /اربط شركة الشحن/ }).click();
  await expect(page.getByText("اربط متجرك الأول.")).toBeVisible();
  await steps.getByRole("button", { name: /أول أوردر/ }).click();
  await expect(page.getByText("مستنيين أول أوردر")).toBeVisible();

  // Store step: a wrong address is caught here; a right one reaches the API (no Shopify app in this stack: its answer in Arabic).
  await steps.getByRole("button", { name: /اربط متجر شوبيفاي/ }).click();
  const address = page.getByLabel("عنوان المتجر");
  await address.fill("nileabayas.com");
  await page.getByRole("button", { name: "اربط شوبيفاي" }).click();
  await expect(page.getByText("العنوان ده مش شكل متجر شوبيفاي.")).toBeVisible();
  await address.fill("nile-abayas");
  await page.getByRole("button", { name: "اربط شوبيفاي" }).click();
  await expect(page.locator(".mz-toast")).toContainText("ربط شوبيفاي مش متفعّل على السيرفر");
  await page.screenshot({ path: "test-results/onboarding-ar.png", fullPage: true });
});

test("Shopify callback page: errors from Shopify and a refused claim are explained; the language is kept", async ({ page }) => {
  const owner = await ownerWithStore("Delta Store");
  await page.goto("/en/sign-in");
  await signInOwner(page, owner, "en");
  await expect(page).toHaveURL(/\/en$/);

  // The API redirects to the locale-less path; the cookie language applies and the query survives.
  await page.goto("/integrations/shopify/connect?error=install_cancelled");
  await expect(page).toHaveURL(/\/en\/integrations\/shopify\/connect\?error=install_cancelled$/);
  await expect(page.locator("main").getByRole("alert")).toHaveText("The connection was cancelled in Shopify. Try again when you're ready.");

  await page.goto(`/integrations/shopify/connect?install=${"a".repeat(43)}&shop=nile-abayas.myshopify.com`);
  await expect(page.locator("main").getByRole("alert")).toHaveText("Install link not found or already used"); // the API's own title
  await page.getByRole("link", { name: "Back to setup" }).click();
  await expect(page).toHaveURL(/\/en\/onboarding$/);
});

test("skipping steps and hiding the card are remembered", async ({ page }) => {
  const owner = await ownerWithStore("Skip Store");
  // Skips come from the owner's choice (API): the card follows.
  await mizan(owner.token, "PATCH", "/onboarding", { skip: { courier: true, costs: true } }, owner.storeId);
  await page.goto("/en/sign-in");
  await signInOwner(page, owner, "en");
  const card = page.getByTestId("setup-card");
  await expect(card).toContainText("2 of 4 steps done. Next: Connect your Shopify store.");
  await card.getByRole("button", { name: "Hide" }).click();
  await expect(card).toBeHidden();
  await page.reload();
  await expect(page.getByTestId("store-name")).toHaveText("Skip Store");
  await expect(page.getByTestId("setup-card")).toBeHidden();
});

test("agents never see setup", async ({ page }) => {
  const phone = newPhone();
  await agentIn(phone, "Agents Store");
  await page.goto("/en/sign-in");
  await signInWithPhone(page, phone, "en");
  await expect(page.getByTestId("store-name")).toHaveText("Agents Store");
  await expect(page.getByTestId("setup-card")).toBeHidden();
  await page.goto("/en/onboarding");
  await expect(page).toHaveURL(/\/en$/);
});
