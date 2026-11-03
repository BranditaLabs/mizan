import { expect, test } from "@playwright/test";
import { mizan, ownerWithStore, signInOwner } from "./stack";

/** O4: invoices and packing slips in Arabic, one page per order, from the order page and for many at once. */
test("owner in Arabic prints two orders' invoices, then their packing slips", async ({ page, context }) => {
  const owner = await ownerWithStore("متجر الطباعة");
  const create = (name: string, mode: "cod" | "prepaid") => mizan<{ id: string; number: string }>(owner.token, "POST", "/orders", {
    source: "phone", customer: { name, phone: "01001234821" }, address: { line1: "12 شارع عباس العقاد", city: "مدينة نصر" },
    lines: [{ title: "عباية سادة", quantity: 2, unitPrice: "600" }], shipping: "50",
    payment: mode === "cod" ? { mode } : { mode, method: "wallet" },
  }, owner.storeId);
  const a = await create("منى عادل", "cod");
  const b = await create("كريم سعيد", "prepaid");

  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);

  // From the order page: the invoice opens in a new tab.
  await page.goto(`/ar/orders/${a.id}`);
  const [tab] = await Promise.all([context.waitForEvent("page"), page.getByRole("link", { name: "اطبع الفاتورة" }).click()]);
  await expect(tab.getByTestId("document")).toHaveCount(1);
  await expect(tab.getByTestId("document")).toContainText("فاتورة");
  await expect(tab.getByTestId("document")).toContainText("منى عادل");
  await expect(tab.locator("html")).toHaveAttribute("dir", "rtl");
  await tab.close();

  await page.goto(`/ar/print/orders?kind=invoice&ids=${a.id},${b.id}`);
  const docs = page.getByTestId("document");
  await expect(docs).toHaveCount(2);
  await expect(docs.nth(0)).toContainText(a.number);
  await expect(docs.nth(0)).toContainText(/1[,٬]?250/); // 2 × 600 + 50
  await expect(docs.nth(0)).toContainText("يتحصّل عند الاستلام");
  await expect(docs.nth(1)).toContainText("كريم سعيد");
  await expect(docs.nth(1)).not.toContainText("يتحصّل عند الاستلام"); // prepaid: nothing to collect
  await expect(page.getByRole("button", { name: "اطبع أو احفظ PDF" })).toBeEnabled();

  await page.getByRole("link", { name: "اعرض إيصالات التجهيز بدالها" }).click();
  await expect(page).toHaveURL(/kind=packing_slip/);
  await expect(docs).toHaveCount(2);
  await expect(docs.nth(0)).toContainText("إيصال تجهيز");
  await expect(docs.nth(0)).toContainText("قطعتين في المجموع");
});
