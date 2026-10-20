import { expect, test } from "@playwright/test";
import { agentIn, confirmEmail, mizan, newEmail, newPhone, PASSWORD, signInWithPhone, smsCode, smsCount, storeWithInvites } from "./stack";

/**
 * E4-2 journeys on the Firebase Auth emulator and the real API (AUTH_REQUIRE_MFA=true, as in
 * production): owners need email + an SMS second step; agents sign in with their phone.
 */

test("owner: new account → store → two-step verification → signs in with the code → home", async ({ page }) => {
  const email = newEmail("owner");
  const phone = newPhone();

  // A signed-out visitor is sent to sign-in, with the way back.
  await page.goto("/en");
  await expect(page).toHaveURL(/\/en\/sign-in\?next=%2F$/);
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  // No store yet: create one.
  await expect(page).toHaveURL(/\/en\/welcome$/);
  await page.getByLabel("Store name").fill("Nile Threads");
  await expect(page.getByLabel("Country")).toHaveValue("EG");
  await page.getByRole("button", { name: "Create store" }).click();

  // The API refuses an owner without a second factor (mfa_required): turn it on.
  await expect(page).toHaveURL(/\/en\/security\/two-step$/);
  await page.getByRole("button", { name: "Send confirmation link" }).click();
  await expect(page.getByText("Link sent. Check your email.")).toBeVisible();
  await page.getByRole("button", { name: "I confirmed my email" }).click();
  await expect(page.getByText("Your email is not confirmed yet.")).toBeVisible();
  await confirmEmail(email);
  await page.getByRole("button", { name: "I confirmed my email" }).click();
  await page.getByLabel("Phone number").fill(phone.national);
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("Code").fill(await smsCode({ phone: phone.e164 }));
  await page.getByRole("button", { name: "Turn on" }).click();

  // Signed out; sign in again with email, password and the texted code.
  await expect(page).toHaveURL(/\/en\/sign-in\?enrolled=1$/);
  await expect(page.getByText("Two-step verification is on.")).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText("That email or password is not right.");
  await page.getByLabel("Password").fill(PASSWORD);
  const seen = await smsCount(phone.e164);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Second step" })).toBeVisible();
  await expect(page.getByText(`ending in ${phone.e164.slice(-4)}`)).toBeVisible();
  await page.getByLabel("Code").fill("000000");
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText("That code is wrong. Check the message and type it again.");
  await page.getByLabel("Code").fill(await smsCode({ phone: phone.e164 }, seen));
  await page.getByRole("button", { name: "Verify and sign in" }).click();

  await expect(page).toHaveURL(/\/en$/);
  await expect(page.getByTestId("store-name")).toHaveText("Nile Threads");
  await expect(page.locator("aside").getByTestId("store-role")).toHaveText("Owner");
  await expect(page.getByTestId("user-id")).toHaveText(email);
  await page.screenshot({ path: "test-results/owner-home-en.png", fullPage: true });

  // Sign out: back to sign-in, and the store pages are closed again.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/en\/sign-in$/);
  await page.goto("/en");
  await expect(page).toHaveURL(/\/en\/sign-in\?next=%2F$/);
});

test("agent in Arabic: phone number and code, joins the store they were invited to", async ({ page }) => {
  const phone = newPhone();
  await storeWithInvites("متجر النيل", [{ phone: phone.e164, role: "agent" }]);

  await page.goto("/ar");
  await expect(page).toHaveURL(/\/ar\/sign-in/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("ادخل على ميزان");
  // A number that is not an Egyptian mobile never reaches Firebase.
  await page.getByRole("radio", { name: "رقم الموبايل", exact: true }).click();
  await page.getByLabel("رقم الموبايل", { exact: true }).fill("0123");
  await page.getByRole("button", { name: "ابعت الكود" }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText("رقم الموبايل مش صحيح");
  await page.getByRole("radio", { name: "الإيميل", exact: true }).click();
  await expect(page.getByRole("radio", { name: "الإيميل", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.screenshot({ path: "test-results/sign-in-ar.png", fullPage: true });

  await signInWithPhone(page, phone, "ar");
  await expect(page).toHaveURL(/\/ar\/welcome$/);
  await expect(page.getByRole("heading", { name: "دعوات مستنياك" })).toBeVisible();
  await expect(page.getByText("متجر النيل")).toBeVisible();
  await page.screenshot({ path: "test-results/welcome-ar.png", fullPage: true });
  await page.getByRole("button", { name: "انضم" }).click();

  await expect(page).toHaveURL(/\/ar$/);
  await expect(page.getByTestId("store-name")).toHaveText("متجر النيل");
  await expect(page.locator("aside").getByTestId("store-role")).toHaveText("موظف تأكيد");
});

test("switching stores: the choice is remembered after a reload", async ({ page }) => {
  const phone = newPhone();
  await agentIn(phone, "Cairo Shoes", "Alex Bags");

  await page.goto("/en/sign-in");
  await signInWithPhone(page, phone, "en");
  await expect(page).toHaveURL(/\/en$/);
  const switcher = page.locator("aside").getByTestId("store-switcher");
  const first = await page.getByTestId("store-name").textContent();
  const other = first === "Cairo Shoes" ? "Alex Bags" : "Cairo Shoes";
  await switcher.selectOption({ label: other });
  await expect(page.getByTestId("store-name")).toHaveText(other);
  await page.reload();
  await expect(page.getByTestId("store-name")).toHaveText(other);
  await expect(switcher).toHaveValue(/.+/);
});

test("sign-in never redirects to another site", async ({ page }) => {
  const phone = newPhone();
  await agentIn(phone, "Safe Store");
  await page.goto("/en/sign-in?next=//evil.example/x");
  await signInWithPhone(page, phone, "en");
  await expect(page).toHaveURL(/localhost:3100\/en$/);
});

test("a failed action shows the API's own words: joining a revoked invitation (Arabic)", async ({ page }) => {
  const phone = newPhone();
  const { owner, storeId, invitations } = await storeWithInvites("متجر الدلتا", [{ phone: phone.e164, role: "agent" }]);
  await page.goto("/ar/sign-in");
  await signInWithPhone(page, phone, "ar");
  await expect(page).toHaveURL(/\/ar\/welcome$/);
  await expect(page.getByText("متجر الدلتا")).toBeVisible();

  // The owner takes the invitation back while the agent is looking at it.
  await mizan(owner, "DELETE", `/invitations/${invitations[0]}`, undefined, storeId);
  await page.getByRole("button", { name: "انضم" }).click();
  // The API's title, in Egyptian Arabic, in a toast; the list refreshes and the invitation is gone.
  await expect(page.locator(".mz-toast")).toContainText("الدعوة مش موجودة أو انتهت");
  await expect(page.getByText("متجر الدلتا")).toBeHidden();
});
