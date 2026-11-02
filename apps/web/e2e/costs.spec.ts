import { expect, test } from "@playwright/test";
import { agentIn, newPhone, ownerWithStore, signInOwner, signInWithPhone } from "./stack";

/**
 * E9-1 Settings → Costs in the browser. Versioning, scope resolution and FX lookups run in the
 * API's cost-rules and fx e2e; here: an owner sets costs in Arabic and sees them after a reload,
 * the FX card without a feed, and that an agent cannot open the page.
 */
test("owner in Arabic: sets packaging, COD fee and a courier rate; they stay after reload", async ({ page }) => {
  const owner = await ownerWithStore("متجر التكاليف");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);

  await page.getByRole("link", { name: "الإعدادات" }).click();
  await expect(page).toHaveURL(/\/ar\/settings\/costs$/);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("التكاليف");

  const packaging = main.getByLabel("التغليف (EGP)");
  await packaging.fill("٧٫٥"); // Arabic digits and decimal comma, as typed on an Arabic keyboard
  await packaging.locator("xpath=ancestor::form").getByRole("button", { name: "احفظ" }).click();
  await expect(page.locator(".mz-toast")).toContainText("اتحفظ");

  const cod = main.getByLabel("نسبة رسوم التحصيل %");
  await cod.fill("1.5");
  await cod.locator("xpath=ancestor::form").getByRole("button", { name: "احفظ" }).click();
  await expect(cod.locator("xpath=ancestor::form")).toContainText("من");

  const addRate = main.getByRole("form", { name: "ضيف سعر" });
  await addRate.getByLabel("المنطقة").fill("Cairo");
  await addRate.getByLabel("التوصيل (EGP)").fill("60");
  await addRate.getByLabel("المرتجع (EGP)").fill("30");
  await addRate.getByRole("button", { name: "ضيف سعر" }).click();
  await expect(main.getByText("cairo")).toBeVisible();

  await page.reload();
  await expect(main.getByLabel("التغليف (EGP)")).toHaveValue("7.50");
  await expect(main.getByLabel("نسبة رسوم التحصيل %")).toHaveValue("1.5");
  await expect(main.getByText("بوسطة").first()).toBeVisible();
  // No feed in this stack: the FX card says the rate is missing instead of guessing.
  await expect(main.getByTestId("fx-rates")).toContainText("مفيش سعر لـ");
});

test("an agent cannot open costs", async ({ page }) => {
  const phone = newPhone();
  await agentIn(phone, "Agents Costs Store");
  await page.goto("/en/sign-in");
  await signInWithPhone(page, phone, "en");
  await expect(page.getByTestId("store-name")).toHaveText("Agents Costs Store");
  await page.goto("/en/settings/costs");
  await expect(page.getByRole("main").getByText("Costs are for owners and finance")).toBeVisible();
});
