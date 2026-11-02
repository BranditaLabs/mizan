import { expect, test } from "@playwright/test";
import { ownerWithStore, signInOwner } from "./stack";

/** E6-5 in the browser: the owner writes the Confirm reply with a variable, previews it on a sample order, saves it. */
test("owner in Arabic: edits the confirmation script, previews it and saves it", async ({ page }) => {
  const owner = await ownerWithStore("متجر السكريبت");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await page.goto("/ar/settings/confirmation");
  const editor = page.getByTestId("script-editor");
  await expect(editor).toContainText("{{customer.first_name}}");
  await editor.getByLabel("اتأكّد", { exact: true }).fill("تمام يا {{customer.first_name}} ✅ أوردرك {{order.number}} اتأكّد ونازل الشحن");
  await editor.getByRole("button", { name: "معاينة" }).click();
  const preview = page.getByTestId("script-preview");
  await expect(preview).toContainText("تمام يا منى ✅ أوردرك #1001 اتأكّد ونازل الشحن");
  await expect(preview).toContainText("اكتب لنا التعديل"); // empty boxes keep the Egyptian pack

  await editor.getByLabel("باقة اللغة").selectOption("formal");
  await editor.getByRole("button", { name: "معاينة" }).click();
  await expect(preview).toContainText("يرجى كتابة التعديل المطلوب");

  await page.getByRole("button", { name: "احفظ" }).click();
  await expect(page.locator(".mz-toast")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("script-editor").getByLabel("اتأكّد", { exact: true })).toHaveValue("تمام يا {{customer.first_name}} ✅ أوردرك {{order.number}} اتأكّد ونازل الشحن");
  await expect(page.getByTestId("script-editor").getByLabel("باقة اللغة")).toHaveValue("formal");
});
