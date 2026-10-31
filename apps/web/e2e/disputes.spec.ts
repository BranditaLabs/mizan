import { expect, test } from "@playwright/test";
import { mizan, ownerWithStore, signInOwner } from "./stack";

/**
 * E14-5 in the browser, against the real API: the owner records a chargeback on a paid order,
 * opens the evidence pack (saved as a real PDF here), marks the evidence sent and wins the case.
 * Ledger, profit and audit rules are covered in apps/api (disputes e2e, pnl properties).
 */
test("owner in Arabic: records a chargeback, prints the evidence pack, wins it back", async ({ page }) => {
  const owner = await ownerWithStore("متجر الشنط");
  const order = await mizan<{ id: string; number: string }>(owner.token, "POST", "/orders", {
    source: "phone", customer: { name: "هالة سمير", phone: "01001234961" }, address: { line1: "7 شارع جامعة الدول", city: "الجيزة" },
    lines: [{ title: "شنطة جلد", quantity: 1, unitPrice: "900" }], shipping: "0", payment: { mode: "bank_transfer" },
  }, owner.storeId);
  await mizan(owner.token, "POST", `/orders/${order.id}/payments`, { type: "received", method: "instapay", amount: "900" }, owner.storeId);

  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await page.goto(`/ar/orders/${order.id}`);
  const card = page.getByTestId("order-disputes");
  await expect(card).toContainText("مفيش اعتراض على الدفع في الأوردر ده.");
  await page.getByRole("button", { name: "سجّل اعتراض" }).click();
  const d = page.getByRole("dialog", { name: "تسجيل اعتراض على الدفع" });
  await expect(d.getByLabel("المبلغ اللي اتسحب (EGP)")).toHaveValue("900.00");
  await d.getByLabel("رسوم الاعتراض (EGP)").fill("150");
  await d.getByLabel("السبب").selectOption("not_received");
  await d.getByLabel("رقم القضية").fill("PMB-CB-9");
  await d.getByRole("button", { name: "سجّل", exact: true }).click();
  await expect(page.locator(".mz-toast", { hasText: "اتسجّل D-1001" })).toBeVisible();
  await expect(card).toContainText("مفتوح");
  await expect(card).toContainText("موصلش");

  await card.getByRole("link", { name: "ملف الإثباتات" }).click();
  const pack = page.getByTestId("evidence-pack");
  await expect(pack).toContainText("إثباتات الاعتراض D-1001");
  await expect(pack).toContainText("هالة سمير");
  await expect(pack).toContainText("7 شارع جامعة الدول");
  await expect(pack).toContainText("شنطة جلد");
  await expect(pack).toContainText("PMB-CB-9");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("header.sticky")).toBeHidden();
  await page.pdf({ path: "test-results/evidence-ar.pdf", format: "A4", printBackground: true });
  await page.emulateMedia({ media: "screen" });

  await page.getByRole("link", { name: "ارجع للأوردر" }).click();
  await card.getByRole("button", { name: "الإثباتات اتبعتت" }).click();
  const sent = page.getByRole("dialog", { name: "إثباتات D-1001" });
  await sent.getByLabel("اتبعتت إزاي").fill("اترفعت على بورتال Paymob");
  await sent.getByRole("button", { name: "الإثباتات اتبعتت" }).click();
  await expect(card.getByText("الإثباتات اتبعتت", { exact: true }).first()).toBeVisible();

  await card.getByRole("button", { name: "اقفله" }).click();
  const close = page.getByRole("dialog", { name: "قفل D-1001" });
  await close.getByRole("radio", { name: "كسبناها" }).click();
  await close.getByRole("button", { name: "اقفله" }).click();
  await expect(page.locator(".mz-toast", { hasText: "كسبناها: الفلوس رجعت" })).toBeVisible();
  await expect(card).toContainText("كسبناها");
  await card.screenshot({ path: "test-results/disputes-ar.png" });
});
