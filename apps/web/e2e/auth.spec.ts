import { expect, test, type Page } from "@playwright/test";
import { agentIn, confirmEmail, mizan, newEmail, newPhone, PASSWORD, signInWithPhone, smsCode, smsCount, storeWithInvites } from "./stack";

/**
 * E4-2 journeys on the Firebase Auth emulator and the real API (AUTH_REQUIRE_MFA=true, as in
 * production): owners need email + an SMS second step; agents sign in with their phone.
 */

/** Records every field of the step copies that play the exit (StepHost's [data-ghost]) as they are inserted. */
async function watchGhosts(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __ghosts: Array<{ type: string; value: string }> };
    w.__ghosts = [];
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) {
        if (n instanceof HTMLElement && n.matches("[data-ghost]")) n.querySelectorAll("input").forEach((i) => w.__ghosts.push({ type: i.type, value: i.value }));
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
}
const ghosts = (page: Page) => page.evaluate(() => (window as unknown as { __ghosts: Array<{ type: string; value: string }> }).__ghosts);

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
  await expect(page.getByRole("button", { name: "Create store" })).toBeDisabled(); // until the terms are accepted (L1-3)
  await page.getByTestId("accept-legal").check();
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

  // Signed out; sign in again with email, password and the texted code. Then back where the detour
  // started: the new store's setup (A1), the page the store gate sent the owner away from.
  await expect(page).toHaveURL(/\/en\/sign-in\?enrolled=1&next=%2Fonboarding$/);
  await expect(page.getByText("Two-step verification is on.")).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText("That email or password is not right.");
  // The refused password keeps the focus, selected, so typing replaces it (the alert is announced, not focused).
  await expect(page.getByLabel("Password")).toBeFocused();
  await page.getByLabel("Password").fill(PASSWORD);
  const seen = await smsCount(phone.e164);
  await watchGhosts(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Second step" })).toBeVisible();
  // The exit copy of the email step never holds the typed password, and never shows it as text.
  const copies = await ghosts(page);
  expect(copies.length).toBeGreaterThan(0);
  expect(copies.some((g) => g.value === PASSWORD)).toBe(false);
  expect(copies.filter((g) => g.type === "text" && g.value.includes("•"))).toEqual([]);
  // In the card (the frame's live region says it too, for screen readers).
  await expect(page.locator("main").getByText(`ending in ${phone.e164.slice(-4)}`)).toBeVisible();
  // Six digits submit by themselves; a refused code is selected, so the next one replaces it.
  await page.getByLabel("Verification code", { exact: true }).fill("000000");
  await expect(page.locator("main").getByRole("alert")).toHaveText("That code is wrong. Check the message and type it again.");
  await expect(page.getByLabel("Verification code", { exact: true })).toBeFocused();
  await expect(page.getByRole("button", { name: "Verify and sign in" })).toBeVisible();
  await page.getByLabel("Verification code", { exact: true }).fill(await smsCode({ phone: phone.e164 }, seen));

  await expect(page).toHaveURL(/\/en\/onboarding$/);
  await expect(page.getByRole("radiogroup", { name: "Sales channel" })).toBeVisible();
  await page.goto("/en");
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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("أهلاً بيك تاني");
  // A number that is not an Egyptian mobile never reaches Firebase.
  await page.getByRole("radio", { name: "الموبايل", exact: true }).click();
  await page.getByLabel("رقم الموبايل", { exact: true }).fill("0123");
  await page.getByRole("button", { name: "كمّل", exact: true }).click();
  // A field's error is read through the field (aria-invalid, aria-describedby), not a second alert.
  await expect(page.locator("main").getByText(/رقم الموبايل مش صحيح/)).toBeVisible();
  await expect(page.getByLabel("رقم الموبايل", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("رقم الموبايل", { exact: true })).toBeFocused();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
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

test("sign-up from the pricing page: Welcome sends the chosen plan and billing with the new store", async ({ page }) => {
  await page.goto("/en/sign-in?mode=signup&plan=scale&billing=annual");
  await page.getByLabel("Email").fill(newEmail("owner"));
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/en\/welcome$/);
  await expect(page.getByTestId("trial-chip")).toContainText("Scale");
  await page.getByLabel("Store name").fill("Scale Threads");
  await page.getByTestId("accept-legal").check();
  const create = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/v1/tenants");
  await page.getByRole("button", { name: "Create store" }).click();
  expect((await create).postDataJSON()).toMatchObject({ name: "Scale Threads", plan: "scale", interval: "year" });
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
  await expect(page.locator(".mz-toast")).toContainText(`You're now in ${other}`);
  await page.reload();
  await expect(page.getByTestId("store-name")).toHaveText(other);
  await expect(switcher).toHaveValue(/.+/);
});

test("a session that ends elsewhere says so on sign-in (signed out in another tab)", async ({ page, context }) => {
  const phone = newPhone();
  await agentIn(phone, "Tab Store");
  await page.goto("/en/sign-in");
  await signInWithPhone(page, phone, "en");
  await expect(page).toHaveURL(/\/en$/);
  // A deliberate sign-out in the other tab is, for this tab, a session that ended.
  const other = await context.newPage();
  await other.goto("/en");
  await other.getByRole("button", { name: "Sign out" }).click();
  await expect(other).toHaveURL(/\/en\/sign-in$/);
  await expect(page).toHaveURL(/\/en\/sign-in\?reason=expired&next=%2F$/);
  await expect(page.getByTestId("auth-reason")).toContainText("Your session ended.");
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
