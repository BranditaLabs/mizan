import { expect, test } from "@playwright/test";
import { mizan, ownerWithStore, signInOwner } from "./stack";

/**
 * E14-1 in the browser, against the real API: an order paid by bank transfer, recorded in two
 * steps by the owner; a refund larger than what the order holds is refused, a smaller one
 * recorded. The arithmetic and its properties are covered in apps/api (ledger, payments e2e).
 */
test("owner in Arabic: records a transfer in two parts and a refund; too much back is refused", async ({ page }) => {
  const owner = await ownerWithStore("متجر التحويلات");
  const order = await mizan<{ id: string; number: string }>(owner.token, "POST", "/orders", {
    source: "phone", customer: { name: "منى عادل", phone: "01001234821" }, address: { line1: "12 شارع عباس العقاد", city: "مدينة نصر" },
    lines: [{ title: "عباية سادة", quantity: 1, unitPrice: "1000" }], shipping: "0", payment: { mode: "bank_transfer" },
  }, owner.storeId);

  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await page.goto(`/ar/orders/${order.id}`);
  const ledger = page.getByTestId("ledger");
  await expect(ledger).toContainText("لسه مفيش فلوس اتحركت على الأوردر ده.");
  await expect(ledger).toContainText("1,000");

  const record = async (fill: (d: ReturnType<typeof page.getByRole>) => Promise<void>) => {
    await page.getByRole("button", { name: "سجّل دفعة" }).click();
    const d = page.getByRole("dialog", { name: "تسجيل دفعة" });
    await fill(d);
    await d.getByRole("button", { name: "سجّل", exact: true }).click();
    return d;
  };

  await record(async (d) => {
    await expect(d.getByLabel("المبلغ (EGP)")).toHaveValue("1000.00"); // what is still owed
    await d.getByLabel("طريقة الدفع").selectOption("instapay");
    await d.getByLabel("المبلغ (EGP)").fill("٤٠٠");
    await d.getByLabel("ملاحظة").fill("IPN-7781");
  });
  await expect(page.locator(".mz-toast", { hasText: "اتسجّلت في المدفوعات" })).toBeVisible();
  await expect(ledger.getByRole("listitem")).toHaveCount(1);
  await expect(ledger).toContainText("إنستاباي");
  await expect(ledger).toContainText("الفريق");
  await expect(ledger).toContainText("IPN-7781");

  await record(async (d) => { await expect(d.getByLabel("المبلغ (EGP)")).toHaveValue("600.00"); });
  await expect(ledger.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("main").getByText("مدفوع", { exact: true }).first()).toBeVisible();

  const refused = await record(async (d) => {
    await d.getByRole("radio", { name: "رجعت للعميل" }).click();
    await d.getByLabel("المبلغ (EGP)").fill("1500");
  });
  await expect(refused.getByRole("alert")).toContainText("المبلغ أكبر من اللي معاك من الأوردر ده.");
  await refused.getByLabel("المبلغ (EGP)").fill("150");
  await refused.getByRole("button", { name: "سجّل", exact: true }).click();
  await expect(ledger.getByRole("listitem")).toHaveCount(3);
  await expect(ledger).toContainText("850");
  await page.setViewportSize({ width: 1280, height: 1600 });
  await ledger.locator("xpath=ancestor::section[1]").or(ledger.locator("..")).first().screenshot({ path: "test-results/ledger-ar.png" });
});
