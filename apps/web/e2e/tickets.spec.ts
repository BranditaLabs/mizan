import { expect, test } from "@playwright/test";
import { agentIn, mizan, newPhone, ownerWithStore, signInOwner, signInWithPhone } from "./stack";

/**
 * E10-1 in the browser, against the real API: a ticket opened from its order, worked (status,
 * assignee, a note) and found again in the list. Scope, numbering and the rules run in apps/api.
 */
test("owner in Arabic: opens a ticket from the order, works it, finds it in the list", async ({ page }) => {
  const owner = await ownerWithStore("متجر التذاكر");
  const order = await mizan<{ id: string; number: string }>(owner.token, "POST", "/orders", {
    source: "whatsapp", customer: { name: "منى عادل", phone: "01001234821" }, address: { line1: "12 شارع عباس العقاد", city: "مدينة نصر" },
    lines: [{ title: "عباية سادة", quantity: 1, unitPrice: "1000" }], shipping: "0", payment: { mode: "cod" },
  }, owner.storeId);

  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await page.goto(`/ar/orders/${order.id}`);
  const card = page.getByTestId("order-tickets");
  await expect(card).toContainText("مفيش تذاكر للأوردر ده.");
  await page.getByRole("button", { name: "افتح تذكرة" }).click();
  const dialog = page.getByRole("dialog", { name: "تذكرة جديدة" });
  await expect(dialog).toContainText(order.number);
  await dialog.getByLabel("النوع").selectOption("exchange");
  await dialog.getByLabel("السبب").selectOption("wrong_size");
  await dialog.getByLabel("جت منين").selectOption("whatsapp");
  await dialog.getByLabel("الوصف").fill("عايزة مقاس L بدل M");
  await dialog.getByRole("button", { name: "افتح التذكرة" }).click();
  await expect(page.locator(".mz-toast", { hasText: "اتفتحت التذكرة T-1001" })).toBeVisible();
  await expect(page).toHaveURL(/\/ar\/tickets\/[0-9a-f-]{36}$/);

  const ticket = page.getByTestId("ticket");
  await expect(ticket.getByRole("heading", { level: 1 })).toHaveText("T-1001");
  await expect(ticket).toContainText("استبدال");
  await expect(ticket).toContainText("مقاس غلط");
  await expect(ticket).toContainText("عايزة مقاس L بدل M");

  await ticket.getByLabel("الحالة").selectOption("waiting_courier");
  await ticket.getByRole("button", { name: "احفظ" }).click();
  await expect(page.locator(".mz-toast", { hasText: "اتحفظت" })).toBeVisible();
  await expect(ticket.locator(".mz-badge").first()).toHaveText("مستنية شركة الشحن");
  await ticket.getByLabel("ضيف ملاحظة").fill("كلّمنا بوسطة عشان يرجّع الشحنة");
  await ticket.getByRole("button", { name: "ضيف الملاحظة" }).click();
  await expect(ticket.getByRole("list", { name: "السجل" })).toContainText("كلّمنا بوسطة عشان يرجّع الشحنة");
  await expect(ticket.getByRole("list", { name: "السجل" })).toContainText("من مفتوحة لـ مستنية شركة الشحن");
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.screenshot({ path: "test-results/ticket-ar.png", fullPage: true });

  await page.getByRole("navigation", { name: "القايمة الرئيسية" }).getByRole("link", { name: "التذاكر" }).click();
  await expect(page).toHaveURL(/\/ar\/tickets$/);
  const list = page.getByTestId("tickets");
  await expect(list.getByRole("tab", { name: /شغّالة/ })).toContainText("1");
  await expect(list.getByRole("row", { name: /T-1001/ })).toContainText(order.number);
  await list.getByRole("searchbox").fill("9999");
  await expect(list).toContainText("مفيش تذكرة بالرقم ده");
});

test("an agent in English opens a ticket without an order; it is theirs", async ({ page }) => {
  const phone = newPhone();
  await agentIn(phone, "Agents Tickets Store");
  await page.goto("/en/sign-in");
  await signInWithPhone(page, phone, "en");
  await expect(page.getByTestId("store-name")).toHaveText("Agents Tickets Store");
  await page.goto("/en/tickets");
  await page.getByRole("main").getByRole("button", { name: "New ticket" }).click();
  const dialog = page.getByRole("dialog", { name: "New ticket" });
  await dialog.getByLabel("Type").selectOption("complaint");
  await dialog.getByLabel("Order", { exact: true }).fill("#4040");
  await dialog.getByRole("button", { name: "Open ticket" }).click();
  await expect(dialog).toContainText("No order with this number in this store");
  await dialog.getByLabel("Order", { exact: true }).fill("");
  await dialog.getByRole("button", { name: "Open ticket" }).click();
  await expect(page).toHaveURL(/\/en\/tickets\/[0-9a-f-]{36}$/);
  const ticket = page.getByTestId("ticket");
  await expect(ticket).toContainText("No order");
  await expect(ticket.getByLabel("Assigned to")).not.toHaveValue("");
});
