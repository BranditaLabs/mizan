import { expect, test } from "@playwright/test";
import { mizan, ownerWithStore, signInOwner } from "./stack";

async function shippedOrder(owner: { token: string; storeId: string }, tracking: string) {
  const o = await mizan<{ id: string; number: string }>(owner.token, "POST", "/orders", {
    source: "phone", customer: { name: "منى عادل", phone: "01001119991" }, address: { line1: "12 شارع عباس العقاد", city: "مدينة نصر" },
    lines: [{ title: "عباية سادة", quantity: 2, unitPrice: "1000" }], shipping: "50", payment: { mode: "cod" },
  }, owner.storeId);
  await expect(async () => {
    await mizan(owner.token, "POST", `/orders/${o.id}/confirmation`, { answer: "confirm" }, owner.storeId);
  }).toPass({ timeout: 15_000 });
  await mizan(owner.token, "POST", `/orders/${o.id}/ship/manual`, { courier: "J&T", trackingNumber: tracking }, owner.storeId);
  return o;
}

/** E10-4 in the browser: a customer keeps one of two abayas; another refuses after opening the box. */
test("owner in Arabic: records a partial delivery and a refusal at the door", async ({ page }) => {
  const owner = await ownerWithStore("متجر الباب");
  const a = await shippedOrder(owner, "JT-8001");
  const b = await shippedOrder(owner, "JT-8002");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);

  await page.goto(`/ar/orders/${a.id}`);
  await page.getByRole("button", { name: "خد جزء" }).click();
  const partial = page.getByRole("dialog", { name: "العميل خد جزء من الأوردر" });
  await partial.getByLabel("قطع عباية سادة اللي خدها").fill("1");
  await partial.getByRole("button", { name: "سجّل", exact: true }).click();
  await expect(page.locator(".mz-toast", { hasText: "التسليم الجزئي اتسجّل" })).toBeVisible();
  await expect(page.getByTestId("door")).toContainText("اتسلّم جزء: خد 1، عليه");
  await expect(page.getByTestId("door")).toContainText("1,050.00");
  await expect(page.getByRole("heading", { level: 1 }).locator("..")).toContainText("اتسلّم");

  await page.goto(`/ar/orders/${b.id}`);
  await page.getByRole("button", { name: "رفض الاستلام", exact: true }).click();
  const refusal = page.getByRole("dialog", { name: "رفض الاستلام عند الباب" });
  await refusal.getByLabel("السبب").selectOption("not_as_described");
  await refusal.getByLabel("فتح الطرد وعاين قبل ما يرفض").check();
  await refusal.getByRole("button", { name: "سجّل", exact: true }).click();
  await expect(page.getByTestId("door")).toContainText("رفض: مش زي الوصف");
  await expect(page.getByTestId("door")).toContainText("عاين الطرد");
});
