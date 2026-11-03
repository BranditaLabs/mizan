import { expect, test } from "@playwright/test";
import { agentIn, newPhone, ownerWithStore, signInOwner, signInWithPhone } from "./stack";

/** U3: the menu follows the role, phones get a bottom bar, and ⌘K finds pages, actions and orders. */

test("an agent's menu has only what an agent can open", async ({ page }) => {
  const phone = newPhone();
  await agentIn(phone, "Nile Calls");
  await page.goto("/en/sign-in");
  await signInWithPhone(page, phone, "en");
  const nav = page.getByRole("navigation", { name: "Main menu" });
  await expect(nav.getByRole("link", { name: "Confirmation" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Orders" })).toBeVisible();
  for (const hidden of ["Payments", "Profit", "Products", "Automations", "Settings"]) await expect(nav.getByRole("link", { name: hidden })).toHaveCount(0);

  // ⌘K offers the same pages, never one the agent cannot open.
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Search or jump to" });
  await palette.getByRole("combobox").fill("pay");
  await expect(palette.getByRole("option", { name: "Payments" })).toHaveCount(0);
});

test("⌘K jumps to pages and actions, and finds an order by number", async ({ page }) => {
  const owner = await ownerWithStore("Nile Search");
  const id = "3f2b1c4d-0a1b-4c2d-8e9f-0123456789ab";
  await page.route("**/v1/orders?**", (route) => {
    const q = new URL(route.request().url()).searchParams.get("q");
    if (q !== "1042") return route.fallback();
    return route.fulfill({ json: { data: [{
      id, number: "#1042", status: "new", channel: "store", store: { connectionId: null, provider: null }, customer: { label: "Mona A.", phoneLast4: "4821" },
      total: { amount: "1150.00", currency: "EGP" }, cod: { amount: "1150.00", currency: "EGP" }, paymentMode: "cod", paymentStatus: "unpaid", risk: null, tags: [],
      placedAt: "2026-11-03T09:00:00.000Z", duplicate: null, stock: null,
    }], nextCursor: null } });
  });
  await page.goto("/en/sign-in");
  await signInOwner(page, owner, "en");
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Search or jump to" });
  await palette.getByRole("combobox").fill("purchase");
  await expect(palette.getByRole("option", { name: "New purchase order" })).toBeVisible();
  await palette.getByRole("combobox").fill("1042");
  const hit = palette.getByRole("option", { name: "#1042 · Mona A. · •••• 4821" });
  await expect(hit).toBeVisible();
  await hit.click();
  await expect(page).toHaveURL(new RegExp(`/en/orders/${id}$`));
});

test("on a phone: a bottom bar, and More for the rest", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const owner = await ownerWithStore("Nile Phone");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  const bar = page.getByRole("navigation", { name: "الأقسام" });
  await expect(bar).toBeVisible();
  await expect(bar.getByRole("link")).toHaveCount(4);
  await bar.getByRole("button", { name: "المزيد" }).click();
  const sheet = page.getByRole("dialog", { name: "المزيد" });
  await sheet.getByRole("link", { name: "المشتريات" }).click();
  await expect(page).toHaveURL(/\/ar\/purchasing$/);
  await expect(sheet).toBeHidden();
  await expect(bar.getByRole("button", { name: "المزيد" })).toHaveAttribute("aria-expanded", "false");
});
