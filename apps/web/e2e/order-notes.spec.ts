import { expect, test } from "@playwright/test";
import { mizan, ownerWithStore, signInOwner } from "./stack";

/** O2: the team's notes and tags on the order page; filters and a saved view on the list. */
test("notes and tags in Arabic on the order; in English, filter the list by tag and city and save the view", async ({ page }) => {
  const owner = await ownerWithStore("متجر الوسوم");
  const create = (name: string, city: string) => mizan<{ id: string; number: string }>(owner.token, "POST", "/orders", {
    source: "phone", customer: { name, phone: "01001234821" }, address: { line1: "12 Abbas El Akkad St", city },
    lines: [{ title: "Abaya", quantity: 1, unitPrice: "600" }], shipping: "50", payment: { mode: "cod" },
  }, owner.storeId);
  const giza = await create("Mona Adel", "Giza");
  const cairo = await create("Karim Said", "Cairo");

  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);

  await page.goto(`/ar/orders/${giza.id}`);
  const main = page.getByRole("main");
  const notes = main.getByTestId("order-notes");
  await notes.getByLabel("اكتب ملاحظة").fill("العميلة عايزة تستلم بعد الساعة 5");
  await notes.getByRole("button", { name: "ضيف الملاحظة" }).click();
  await expect(notes).toContainText("العميلة عايزة تستلم بعد الساعة 5");
  await expect(notes).toContainText("إنت");
  await expect(main.getByText("اتضافت ملاحظة")).toBeVisible(); // the timeline says so, without the text

  const tags = main.getByTestId("order-tags");
  await tags.getByLabel("وسم جديد").fill("VIP");
  await tags.getByRole("button", { name: "ضيف", exact: true }).click();
  await expect(tags.getByText("vip", { exact: true })).toBeVisible();
  await expect(main.getByText("اتضاف وسم: vip")).toBeVisible();

  await page.goto("/en/orders");
  const list = page.getByRole("main");
  await expect(list.getByRole("link", { name: giza.number })).toBeVisible();
  await expect(list.getByRole("link", { name: cairo.number })).toBeVisible();
  await expect(list.getByTitle("1 note")).toBeVisible();

  await list.getByLabel("Tag", { exact: true }).selectOption("vip");
  await expect(list.getByRole("link", { name: cairo.number })).toHaveCount(0);
  await expect(list.getByRole("link", { name: giza.number })).toBeVisible();
  await expect(page).toHaveURL(/tag=vip/);

  await list.getByRole("button", { name: "Save view" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name", { exact: true }).fill("VIP orders");
  await dialog.getByLabel("Share with the team").check();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await list.getByRole("button", { name: "Clear filters" }).click();
  await expect(list.getByRole("link", { name: cairo.number })).toBeVisible();
  await list.getByLabel("City", { exact: true }).selectOption("Cairo");
  await expect(list.getByRole("link", { name: giza.number })).toHaveCount(0);

  await list.getByLabel("Saved view", { exact: true }).selectOption({ label: "VIP orders (team)" });
  await expect(list.getByLabel("Tag", { exact: true })).toHaveValue("vip");
  await expect(list.getByLabel("City", { exact: true })).toHaveValue("");
  await expect(list.getByRole("link", { name: giza.number })).toBeVisible();
  await expect(list.getByRole("link", { name: cairo.number })).toHaveCount(0);
});
