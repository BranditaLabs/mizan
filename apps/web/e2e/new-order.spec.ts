import { expect, test } from "@playwright/test";
import { ownerWithStore, signInOwner } from "./stack";

/**
 * E5-5 a manual order in the browser, against the real API (rebuilt): the form refuses what is
 * missing, a district typed as the area finds its governorate (what the courier books by), the
 * summary shows what the courier collects, a last look before it is created and opened (M-1001),
 * and the same phone next time shows the customer's open order and their address to use again.
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

  await form.getByRole("button", { name: "راجع الأوردر" }).click();
  await expect(form.getByRole("alert").first()).toBeVisible();
  await expect(form).toContainText("اكتب اسم العميل");
  await expect(form).toContainText("ضيف منتج واحد على الأقل");

  await form.getByLabel("الموبايل").fill("01001234821");
  await expect(form.getByTestId("phone-read")).toContainText("+201001234821");
  await expect(form.getByTestId("customer-history")).toContainText("عميل جديد");
  await form.getByLabel("الاسم").fill("منى عادل");
  await form.getByLabel("طلب عن طريق").selectOption("whatsapp");
  // A district typed as the area: Mizan says where it is, one tap sets the governorate.
  await form.getByLabel("المنطقة").fill("شيراتون");
  await form.getByRole("button", { name: "خليها القاهرة" }).click();
  await expect(form.getByLabel("المحافظة")).toHaveValue("Cairo");
  await form.getByLabel("الشارع والعمارة").fill("12 شارع عباس العقاد");
  await form.getByLabel("اللوكيشن على الخريطة").fill("https://www.google.com/maps/@30.0961,31.3735,17z");
  await expect(form.getByTestId("address-pin")).toBeVisible();
  await form.getByText("منتج مش في الكتالوج").click();
  await form.getByLabel("المنتج", { exact: true }).fill("عباية سادة");
  await form.getByLabel("السعر").last().fill("1150");
  await form.getByRole("button", { name: "ضيف المنتج" }).click();
  await form.getByTestId("order-lines").getByRole("button", { name: "واحد زيادة" }).click();
  await form.getByLabel("مصاريف الشحن").fill("50");
  await form.getByLabel("العميل هيدفع إزاي؟").selectOption("partial");
  await form.getByLabel("دفع عن طريق").selectOption("instapay");
  await form.getByLabel("العربون اللي اتدفع").fill("300");
  const summary = form.getByTestId("order-summary");
  await expect(summary).toContainText("2,350");
  await expect(summary).toContainText("2,050");
  await page.setViewportSize({ width: 1280, height: 1500 });
  await form.screenshot({ path: "test-results/new-order-ar.png" });

  await form.getByRole("button", { name: "راجع الأوردر" }).click();
  const review = page.getByTestId("order-review");
  await expect(review).toContainText("منى عادل");
  await expect(review).toContainText("شيراتون");
  await expect(review).toContainText("معاه اللوكيشن");
  await page.getByRole("dialog").getByRole("button", { name: "اعمل الأوردر" }).click();
  await expect(page.locator(".mz-toast")).toContainText("اتعمل الأوردر M-1001");
  await expect(page).toHaveURL(/\/ar\/orders\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("main")).toContainText("M-1001");
  await expect(page.getByRole("main")).toContainText("عباية سادة");

  // The same phone again: her open order (a likely duplicate) and her address, one tap away.
  await page.goto("/ar/orders/new");
  await form.getByLabel("الموبايل").fill("01001234821");
  const history = form.getByTestId("customer-history");
  await expect(history).toContainText("M-1001");
  await history.getByRole("button", { name: "استخدم الاسم" }).click();
  await history.getByRole("button", { name: "استخدم آخر عنوان" }).click();
  await expect(form.getByLabel("الاسم")).toHaveValue("منى عادل");
  await expect(form.getByLabel("المحافظة")).toHaveValue("Cairo");
  await expect(form.getByLabel("الشارع والعمارة")).toHaveValue("12 شارع عباس العقاد");
  await expect(form.getByTestId("address-pin")).toBeVisible();
});
