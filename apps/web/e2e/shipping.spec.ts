import { expect, test } from "@playwright/test";
import { mizan, ownerWithStore, signInOwner } from "./stack";

/**
 * E7-1 in the browser: a confirmed order offers "Ship it"; without a courier connected the API
 * refuses and the screen says what to do. Booking through the courier (fake Bosta, the worker,
 * the tracking number) runs in the API's shipping e2e.
 */
test("owner in Arabic: a confirmed order offers shipping, and says to connect a courier first", async ({ page }) => {
  const owner = await ownerWithStore("متجر الشحن");
  const o = await mizan<{ id: string; number: string }>(owner.token, "POST", "/orders", {
    source: "phone", customer: { name: "منى عادل", phone: "01001117771" }, address: { line1: "12 شارع عباس العقاد", city: "مدينة نصر" },
    lines: [{ title: "عباية سادة", quantity: 1, unitPrice: "1250" }], payment: { mode: "cod" },
  }, owner.storeId);
  // The worker starts the order's confirmation; the team then confirms it.
  await expect(async () => {
    await mizan(owner.token, "POST", `/orders/${o.id}/confirmation`, { answer: "confirm" }, owner.storeId);
  }).toPass({ timeout: 15_000 });

  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await page.goto(`/ar/orders/${o.id}`);
  const card = page.getByTestId("shipping");
  await expect(card).toContainText("الأوردر متأكّد وجاهز: احجز الشحن.");
  await page.getByRole("button", { name: "اشحن الأوردر" }).click();
  await expect(page.locator(".mz-toast", { hasText: "اربط شركة شحن الأول" })).toBeVisible();
});

/** E7-3: the shipping screen from the menu, its views and the empty review queue. */
test("owner in English: the shipping screen lists views and an empty review queue", async ({ page }) => {
  const owner = await ownerWithStore("Shipping Views");
  await page.goto("/en/sign-in");
  await signInOwner(page, owner, "en");
  await expect(page).toHaveURL(/\/en$/);
  await page.getByRole("link", { name: "Shipping" }).click();
  await expect(page).toHaveURL(/\/en\/shipping$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Shipping");
  const tabs = page.getByRole("tablist", { name: "Shipments" });
  await expect(tabs.getByRole("tab")).toHaveCount(5);
  await tabs.getByRole("tab", { name: /Needs review/ }).click();
  await expect(page.getByTestId("shipments")).toContainText("Nothing to review");
});
