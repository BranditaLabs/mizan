import { expect, test } from "@playwright/test";
import { mizan, newPhone, ownerWithStore, phoneUser, signInOwner } from "./stack";

/** A-8: the store's own admin area — team, integrations and the audit log — in both languages. */
test("owner in English: invites, changes a role, disables, revokes; the audit log shows it all", async ({ page }) => {
  const owner = await ownerWithStore("Admin area store");
  const agent = newPhone();
  const inv = await mizan<{ id: string }>(owner.token, "POST", "/members/invite", { phone: agent.e164, role: "agent" }, owner.storeId);
  await mizan(await phoneUser(agent.e164), "POST", `/invitations/${inv.id}/accept`);

  await page.goto("/en/sign-in");
  await signInOwner(page, owner, "en");
  await expect(page).toHaveURL(/\/en$/);
  await page.goto("/en/settings/team");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Team");
  const team = page.getByTestId("team-table");
  await expect(team.getByRole("row")).toHaveCount(3); // header, owner, agent

  // Invite someone new by phone, then revoke the invitation.
  const next = newPhone();
  await page.getByTestId("invite-form").getByLabel("Phone", { exact: true }).fill(next.national);
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByTestId("invitations")).toContainText(next.e164);
  await page.getByTestId("invitations").getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("No pending invitations.")).toBeVisible();

  // Make the agent an ops manager, then disable them.
  const agentRow = team.getByRole("row").filter({ hasText: agent.e164 });
  await agentRow.getByLabel("Role").selectOption("ops_manager");
  await expect(agentRow.getByLabel("Role")).toHaveValue("ops_manager");
  await agentRow.getByRole("button", { name: "Disable" }).click();
  await expect(agentRow).toContainText("Disabled");

  await page.goto("/en/settings/audit");
  const log = page.getByTestId("audit-log");
  await expect(log).toContainText("Invited someone");
  await expect(log).toContainText("Revoked an invitation");
  await expect(log).toContainText("Changed a member");
  await page.getByLabel("Show").selectOption("member.");
  await expect(log.getByRole("row").filter({ hasText: "Joined the store" })).toHaveCount(1);
});

test("owner in Arabic: integrations say what to connect; tabs are right to left", async ({ page }) => {
  const owner = await ownerWithStore("متجر الربط");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await page.goto("/ar/settings/integrations");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("الربط");
  await expect(page.getByTestId("integrations-settings")).toContainText("لسه مفيش حاجة مربوطة");
  await expect(page.getByTestId("integrations-settings")).toContainText("مفيش حاجة مستنية.");
  await expect(page.getByRole("navigation", { name: "الإعدادات" }).getByRole("link", { name: "سجل التغييرات" })).toBeVisible();
});

test("owner in Arabic: renames the store and moves its time zone; it stays after a reload", async ({ page }) => {
  const owner = await ownerWithStore("متجر الاسم القديم");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await page.goto("/ar/settings/store");
  const form = page.getByTestId("store-profile");
  await expect(form.getByLabel("اسم المتجر")).toHaveValue("متجر الاسم القديم");
  await form.getByLabel("اسم المتجر").fill("متجر الاسم الجديد");
  await form.getByLabel("المنطقة الزمنية").selectOption("Asia/Riyadh");
  await form.getByRole("button", { name: "احفظ" }).click();
  await expect(page.getByText("اتحفظ")).toBeVisible();
  await page.reload();
  await expect(form.getByLabel("اسم المتجر")).toHaveValue("متجر الاسم الجديد");
  await expect(form.getByLabel("المنطقة الزمنية")).toHaveValue("Asia/Riyadh");
  await expect(form).toContainText("EGP");
});

/** E5-7: an owner connects a WooCommerce store with its REST keys; the keys are checked in the background. */
test("owner in Arabic: connects a WooCommerce store with its keys; it shows as being checked", async ({ page }) => {
  const owner = await ownerWithStore("متجر ووكومرس");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await page.goto("/ar/settings/integrations");
  await page.getByRole("button", { name: "اربط متجر ووكومرس" }).click();
  const dialog = page.getByRole("dialog", { name: "اربط ووكومرس" });
  await dialog.getByLabel("عنوان المتجر").fill("shop.example.test");
  await dialog.getByRole("button", { name: "أو حط المفاتيح بإيدك" }).click();
  await expect(dialog).toContainText("Read/Write");
  await dialog.getByLabel("الـ Consumer key").fill("pk_wrong");
  await expect(dialog).toContainText("الـ consumer key بيبدأ بـ ck_");
  await expect(dialog.getByRole("button", { name: "اربط", exact: true })).toBeDisabled();
  await dialog.getByLabel("الـ Consumer key").fill("ck_0123456789abcdef");
  await dialog.getByLabel("الـ Consumer secret").fill("cs_0123456789abcdef");
  await dialog.getByRole("button", { name: "اربط", exact: true }).click();
  await expect(page.locator(".mz-toast", { hasText: "ميزان بيتأكد من المفاتيح" })).toBeVisible();
  const list = page.getByTestId("connections");
  await expect(list).toContainText("ووكومرس");
  await expect(list).toContainText("shop.example.test");
  await expect(list).toContainText("بنراجع");
});

/** E5-7 one click: the owner is sent to WooCommerce's approval page, and told how it went on return. */
test("owner in English: approves Mizan in WooCommerce in one click, and sees the result on return", async ({ page }) => {
  const owner = await ownerWithStore("Woo One Click");
  await page.route("https://approve.example.test/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>WooCommerce approval</body></html>" }));
  await page.goto("/en/sign-in");
  await signInOwner(page, owner, "en");
  await expect(page).toHaveURL(/\/en$/);
  await page.goto("/en/settings/integrations");
  await page.getByRole("button", { name: "Connect a WooCommerce store" }).click();
  const dialog = page.getByRole("dialog", { name: "Connect WooCommerce" });
  await dialog.getByLabel("Store address").fill("approve.example.test");
  await dialog.getByRole("button", { name: "Approve in WooCommerce" }).click();
  await page.waitForURL(/approve\.example\.test\/wc-auth\/v1\/authorize/);
  const url = new URL(page.url());
  expect(url.searchParams.get("scope")).toBe("read_write");
  expect(url.searchParams.get("return_url")).toContain("/en/settings/integrations?woo=returned");

  await page.goto("/en/settings/integrations?woo=returned&success=0&user_id=x");
  await expect(page.locator(".mz-toast", { hasText: "WooCommerce didn't approve Mizan" })).toBeVisible();
  await expect(page).toHaveURL(/\/en\/settings\/integrations$/);
});
