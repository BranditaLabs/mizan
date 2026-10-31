import { expect, test } from "@playwright/test";
import { mizan, ownerWithStore, signInOwner } from "./stack";

/**
 * E7-1 and E7-2 in the browser: a confirmed order is ready to ship (its page, and the shipping
 * screen's ready tab for many at once); without a courier connected the API
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
  // E7-2: the confirmed order waits in the shipping screen's ready tab; shipping it without a courier says what to do.
  await page.goto("/ar/shipping");
  const ready = page.getByTestId("ready-to-ship");
  await expect(ready).toContainText(o.number);
  await ready.getByLabel(`اختار ${o.number}`).check();
  await ready.getByRole("button", { name: "اشحن مع شركة الشحن" }).click();
  await page.getByRole("dialog", { name: "نشحن 1 أوردر؟" }).getByRole("button", { name: "اشحنهم" }).click();
  await expect(page.locator(".mz-toast", { hasText: "اربط شركة شحن الأول" })).toBeVisible();
  await page.goto(`/ar/orders/${o.id}`);
  const card = page.getByTestId("shipping");
  await expect(card).toContainText("الأوردر متأكّد وجاهز: احجز الشحن.");
  await page.getByRole("button", { name: "اشحن الأوردر" }).click();
  await expect(page.locator(".mz-toast", { hasText: "اربط شركة شحن الأول" })).toBeVisible();

  // E7-6: a courier without an API — recorded by hand, then its report delivers it.
  await page.getByRole("button", { name: "سجّل يدوي" }).click();
  const dialog = page.getByRole("dialog", { name: "سجّل شحنة" });
  await dialog.getByLabel("شركة الشحن").fill("J&T");
  await dialog.getByLabel("رقم الشحنة").fill("JT-5001");
  await dialog.getByRole("button", { name: "سجّل", exact: true }).click();
  await expect(card).toContainText("JT-5001");
  await expect(card).toContainText("J&T");

  await page.goto("/ar/shipping");
  await page.getByRole("button", { name: "استورد الحالات" }).click();
  const imp = page.getByRole("dialog", { name: "استورد حالات شركة الشحن" });
  await imp.getByLabel("أو الصقه هنا").fill("رقم الشحنة,الحالة\nJT-5001,تم التسليم\nJT-0000,مرتجع");
  await imp.getByRole("button", { name: "استورد" }).click();
  await expect(imp.getByTestId("status-import-errors")).toContainText("مفيش شحنة بالرقم ده");
  await imp.getByLabel("أو الصقه هنا").fill("رقم الشحنة,الحالة\nJT-5001,تم التسليم");
  await imp.getByRole("button", { name: "استورد" }).click();
  await expect(page.locator(".mz-toast", { hasText: "اتحدّث 1" })).toBeVisible();
  await page.getByRole("tablist", { name: "الشحنات" }).getByRole("tab", { name: /اتسلّمت/ }).click();
  await expect(page.getByTestId("shipments")).toContainText("JT-5001");
  // E7-4: the courier's scorecard by zone.
  const score = page.getByTestId("scorecard");
  await expect(score).toContainText("J&T");
  await expect(score).toContainText("1 شحنة · 100.0٪ اتسلّمت");
  await page.goto(`/ar/orders/${o.id}`);
  await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText("اتسلّم");
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
  await expect(tabs.getByRole("tab")).toHaveCount(6);
  await expect(page.getByTestId("ready-to-ship")).toContainText("Nothing waiting to ship");
  await tabs.getByRole("tab", { name: /Needs review/ }).click();
  await expect(page.getByTestId("shipments")).toContainText("Nothing to review");
});
