import { expect, test } from "@playwright/test";
import { mizan, ownerWithStore, signInOwner } from "./stack";

/**
 * E6-3 the team's call queue in the browser, against the real API and its worker: an order typed
 * by hand goes to the team's calls (no WhatsApp number); "Start calling" claims it, shows the
 * script and the outcome buttons; "the customer confirmed" ends it and the queue is empty.
 * Claiming, retries and two callers run in the API's call-queue e2e.
 */
test("owner in Arabic: takes the next call, confirms it, and the queue empties", async ({ page }) => {
  const owner = await ownerWithStore("متجر المكالمات");
  // Calls all day, so the order is due now whatever the time the suite runs.
  const cfg = await mizan<{ settings: Record<string, unknown> }>(owner.token, "GET", "/settings/confirmation", undefined, owner.storeId);
  await mizan(owner.token, "PUT", "/settings/confirmation", { ...cfg.settings, callingHours: { start: "00:00", end: "23:59" } }, owner.storeId);
  const o = await mizan<{ number: string }>(owner.token, "POST", "/orders", {
    source: "phone", customer: { name: "منى عادل", phone: "01001113331" }, address: { line1: "12 شارع عباس العقاد", city: "مدينة نصر" },
    lines: [{ title: "عباية سادة", quantity: 2, unitPrice: "575" }], payment: { mode: "cod" },
  }, owner.storeId);
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await page.getByRole("link", { name: "التأكيد" }).click();
  await expect(page).toHaveURL(/\/ar\/confirmation$/);
  const main = page.getByTestId("call-queue");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("مكالمات التأكيد");
  await expect(main.getByTestId("queue-counts")).toContainText("مستنيين دلوقتي1", { timeout: 15_000 });

  await main.getByRole("button", { name: "ابدأ المكالمات" }).click();
  const call = main.getByTestId("call-order");
  await expect(call).toContainText(o.number);
  await expect(call).toContainText("عباية سادة");
  await expect(call.getByTestId("call-script")).toContainText(o.number);
  await page.setViewportSize({ width: 1280, height: 1300 });
  await main.screenshot({ path: "test-results/call-queue-ar.png" });
  await call.getByTestId("call-panel").getByRole("button", { name: "العميل أكّد" }).click();
  await expect(page.locator(".mz-toast")).toBeVisible();

  await main.getByRole("button", { name: "الأوردر اللي بعده" }).click();
  await expect(main).toContainText("مفيش مكالمات دلوقتي");
  await expect(main.getByTestId("queue-counts")).toContainText("مستنيين دلوقتي0");
});
