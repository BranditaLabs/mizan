import { expect, test } from "@playwright/test";
import { BOSS } from "./env.mjs";
import { mizan, newEmail, newPhone, personWithTwoStep, signIn } from "./stack";

/**
 * A-7: Mizan staff run the back office from apps/admin: sign in with two steps, find a store,
 * act on it (the store sees it), check health, find people, flags and announcements; anyone else
 * is refused. Arabic is right to left.
 */
const boss = { email: BOSS!, phone: newPhone() };
const owner = { email: newEmail("owner"), phone: newPhone() };
let ownerToken = "";
let storeId = "";

test.beforeAll(async () => {
  await personWithTwoStep(boss.email, boss.phone);
  ownerToken = await personWithTwoStep(owner.email, owner.phone);
  storeId = (await mizan<{ id: string }>(ownerToken, "POST", "/tenants", { name: "Nile Abayas E2E", country: "EG" })).body.id;
});

test("a merchant who is not staff is refused, with the reason", async ({ page }) => {
  await signIn(page, owner);
  await expect(page.getByText("This account is not on the Mizan staff")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/en\/sign-in$/);
});

test("staff find a store, note it, suspend and reactivate it; the store sees it in its audit log", async ({ page }) => {
  await signIn(page, boss);
  await expect(page.getByRole("heading", { name: "Stores", exact: true })).toBeVisible();
  await page.getByRole("searchbox", { name: "Name, slug or store id" }).fill("Nile Abayas E2E");
  await page.getByRole("link", { name: "Nile Abayas E2E" }).click();
  await expect(page.getByTestId("store-detail")).toBeVisible();

  await page.getByLabel("Add a note").fill("Owner prefers calls after 2pm");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByTestId("store-notes")).toContainText("Owner prefers calls after 2pm");

  await page.getByLabel("Reason", { exact: true }).fill("unpaid invoice");
  await page.getByRole("button", { name: "Suspend store" }).click();
  await expect(page.getByTestId("store-detail").getByText("Suspended", { exact: true })).toBeVisible();
  expect((await mizan<{ code: string }>(ownerToken, "GET", "/orders", undefined, storeId)).body.code).toBe("tenant_inactive");

  await page.getByRole("button", { name: "Reactivate store" }).click();
  await expect(page.getByTestId("store-detail").getByText("Active", { exact: true })).toBeVisible();
  const log = (await mizan<{ data: Array<{ action: string; actor: { type: string } }> }>(ownerToken, "GET", "/audit-log?action=store.", undefined, storeId)).body.data;
  expect(log.map((e) => `${e.actor.type}:${e.action}`)).toEqual(["mizan_staff:store.reactivated", "mizan_staff:store.suspended"]);
});

test("health, users, flags and announcements work end to end", async ({ page }) => {
  await signIn(page, boss);
  await page.getByRole("link", { name: "System health" }).click();
  await expect(page.getByTestId("health-tiles")).toContainText("Jobs waiting");

  await page.getByRole("link", { name: "Users" }).click();
  await page.getByRole("searchbox").fill(owner.email);
  await page.getByRole("button", { name: owner.email }).first().click();
  await expect(page.getByTestId("user-detail")).toContainText("Nile Abayas E2E");

  await page.getByRole("link", { name: "Feature flags" }).click();
  await page.getByLabel("Key").fill("e2e.new_screen");
  await page.getByRole("button", { name: "Add flag" }).click();
  await expect(page.getByTestId("flags")).toContainText("e2e.new_screen");
  await page.getByLabel("Store id").fill(storeId);
  await page.getByRole("button", { name: "On for this store" }).click();
  await expect(page.getByTestId("flags")).toContainText("Nile Abayas E2E: on");
  expect((await mizan<{ flags: Record<string, boolean> }>(ownerToken, "GET", "/flags", undefined, storeId)).body.flags["e2e.new_screen"]).toBe(true);

  await page.getByRole("link", { name: "Announcements" }).click();
  await page.getByLabel("Title in Arabic").fill("صيانة الليلة");
  await page.getByLabel("Title in English").fill("Maintenance tonight");
  await page.getByRole("button", { name: "Post announcement" }).click();
  await expect(page.getByTestId("announcements-list")).toContainText("Maintenance tonight");
  const seen = (await mizan<{ data: Array<{ titleEn: string }> }>(ownerToken, "GET", "/announcements", undefined, storeId)).body.data;
  expect(seen.map((a) => a.titleEn)).toContain("Maintenance tonight");
});

test("Arabic is right to left with the navigation in Arabic", async ({ page }) => {
  await signIn(page, boss);
  await page.goto("/ar/stores");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("link", { name: "صحة النظام" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "المتاجر", exact: true })).toBeVisible();
});
