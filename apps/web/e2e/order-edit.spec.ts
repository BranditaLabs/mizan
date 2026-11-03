import { expect, test } from "@playwright/test";
import { mizan, ownerWithStore, signInOwner } from "./stack";

/** O3: edit a manual order in Arabic — quantity, price, delivery fee and address — and the order follows at once. */
test("owner in Arabic edits a manual order before shipping; the totals and the timeline follow", async ({ page }) => {
  const owner = await ownerWithStore("متجر التعديل");
  const order = await mizan<{ id: string; number: string }>(owner.token, "POST", "/orders", {
    source: "phone", customer: { name: "Mona Adel", phone: "01001234821" }, address: { line1: "12 Abbas El Akkad St", city: "Nasr City" },
    lines: [{ title: "عباية سادة", quantity: 2, unitPrice: "600" }], shipping: "50", payment: { mode: "cod" },
  }, owner.storeId);

  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await page.goto(`/ar/orders/${order.id}`);
  const main = page.getByRole("main");
  await main.getByRole("button", { name: "عدّل الأوردر" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("الأوردر بيتعدّل أول ما تحفظ.")).toBeVisible();
  const edit = dialog.getByTestId("edit-order");
  await edit.getByLabel("الكمية").first().fill("1");
  await edit.getByLabel("سعر القطعة").first().fill("550");
  await edit.getByLabel("مصاريف الشحن").fill("60");
  await edit.getByRole("button", { name: "غيّر العنوان" }).click();
  await edit.getByLabel("الشارع والعمارة").fill("9 شارع النيل");
  await edit.getByLabel("المدينة").fill("الجيزة");
  await dialog.getByRole("button", { name: "احفظ التعديل" }).click();
  await expect(dialog).toHaveCount(0);

  await expect(main.getByText("الأوردر اتعدّل").first()).toBeVisible(); // the toast, then the timeline
  await expect(main.getByText("الجيزة").first()).toBeVisible();
  await expect(main).toContainText("610"); // 550 + 60: the new total, and the cash the courier collects
});
