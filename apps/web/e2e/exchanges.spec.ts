import { expect, test } from "@playwright/test";
import { mizan, ownerWithStore, signInOwner } from "./stack";

/**
 * E10-2 in the browser: a delivered order (shipped with a courier recorded by hand, delivered by
 * the courier's report, its cash collected) is exchanged; the replacement is linked both ways with
 * the credit moved and the difference to collect.
 */
test("owner in Arabic: exchanges a delivered order and opens the linked replacement", async ({ page }) => {
  const owner = await ownerWithStore("متجر الاستبدال");
  const o = await mizan<{ id: string; number: string }>(owner.token, "POST", "/orders", {
    source: "phone", customer: { name: "منى عادل", phone: "01001118881" }, address: { line1: "12 شارع عباس العقاد", city: "مدينة نصر" },
    lines: [{ title: "عباية سادة مقاس L", quantity: 1, unitPrice: "1000" }], payment: { mode: "cod" },
  }, owner.storeId);
  await expect(async () => {
    await mizan(owner.token, "POST", `/orders/${o.id}/confirmation`, { answer: "confirm" }, owner.storeId);
  }).toPass({ timeout: 15_000 });
  await mizan(owner.token, "POST", `/orders/${o.id}/ship/manual`, { courier: "J&T", trackingNumber: "JT-7001" }, owner.storeId);
  await mizan(owner.token, "POST", "/shipments/statuses/import", { csv: "رقم الشحنة,الحالة\nJT-7001,تم التسليم" }, owner.storeId);

  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await page.goto(`/ar/orders/${o.id}`);
  await expect(page.getByTestId("exchanges")).toContainText("مفيش استبدال من الأوردر ده.", { timeout: 15_000 });
  await page.getByRole("button", { name: "استبدال", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("كام عباية سادة مقاس L راجعين").fill("1");
  await dialog.getByLabel("بداله").selectOption({ label: "منتج تاني (مش في الكتالوج)" });
  await dialog.getByLabel("المنتج", { exact: true }).fill("عباية سادة مقاس M");
  await dialog.getByLabel("سعر القطعة").fill("1100");
  await dialog.getByLabel("السبب").selectOption("wrong_size");
  await dialog.getByRole("button", { name: "اعمل الاستبدال" }).click();
  await expect(page.locator(".mz-toast", { hasText: `الأوردر البديل ${o.number}-X1 اتعمل` })).toBeVisible();
  const card = page.getByTestId("exchanges");
  await expect(card).toContainText("مستنيين الحاجة ترجع");
  await expect(card).toContainText("1,000.00"); // credit moved
  await expect(card).toContainText("100.00 ج.م."); // to collect

  await card.getByRole("link", { name: `${o.number}-X1` }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`${o.number}-X1`);
  await expect(page.getByTestId("exchanges")).toContainText(o.number);
});
