import { expect, test } from "@playwright/test";
import { ownerWithStore, signInOwner } from "./stack";

/**
 * E5-5 a manual order in the browser, against the real API: the form refuses what is missing,
 * the summary shows what the courier collects, and the order is created and opened (M-1001).
 * Numbering, the ledger, routing and agents' orders run in the API's manual-orders e2e.
 */
test("owner in Arabic: takes an order on WhatsApp with a deposit and opens it", async ({ page }) => {
  const owner = await ownerWithStore("متجر التليفون");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await page.goto("/ar/orders");
  await page.getByRole("main").getByRole("link", { name: "أوردر جديد" }).click();
  await expect(page).toHaveURL(/\/ar\/orders\/new$/);
  const form = page.getByTestId("new-order");
  await expect(form.getByRole("heading", { level: 1 })).toHaveText("أوردر جديد");

  await form.getByRole("button", { name: "اعمل الأوردر" }).click();
  await expect(form.getByRole("alert").first()).toBeVisible();
  await expect(form).toContainText("اكتب اسم العميل");
  await expect(form).toContainText("ضيف منتج واحد على الأقل");

  await form.getByLabel("الاسم").fill("منى عادل");
  await form.getByLabel("الموبايل").fill("01001234821");
  await form.getByLabel("طلب عن طريق").selectOption("whatsapp");
  await form.getByLabel("الشارع والعمارة").fill("12 شارع عباس العقاد");
  await form.getByLabel("المدينة أو المنطقة").fill("مدينة نصر");
  await form.getByText("منتج مش في الكتالوج").click();
  await form.getByLabel("المنتج", { exact: true }).fill("عباية سادة");
  await form.getByLabel("السعر").last().fill("1150");
  await form.getByRole("button", { name: "ضيف المنتج" }).click();
  await form.getByTestId("order-lines").getByLabel("الكمية").fill("2");
  await form.getByLabel("مصاريف الشحن").fill("50");
  await form.getByLabel("العميل هيدفع إزاي؟").selectOption("partial");
  await form.getByLabel("دفع عن طريق").selectOption("instapay");
  await form.getByLabel("العربون اللي اتدفع").fill("300");
  const summary = form.getByTestId("order-summary");
  await expect(summary).toContainText("2,350");
  await expect(summary).toContainText("2,050");
  await page.setViewportSize({ width: 1280, height: 1500 });
  await form.screenshot({ path: "test-results/new-order-ar.png" });

  await form.getByRole("button", { name: "اعمل الأوردر" }).click();
  await expect(page.locator(".mz-toast")).toContainText("اتعمل الأوردر M-1001");
  await expect(page).toHaveURL(/\/ar\/orders\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("main")).toContainText("M-1001");
  await expect(page.getByRole("main")).toContainText("عباية سادة");
});
