import { expect, test } from "@playwright/test";

/**
 * AU-1: the redesigned frame of the screens before a store (auth spec §10.4). Signed out only; the
 * journeys that sign in are in auth.spec.ts.
 */

test("plan and billing from the pricing page: the trial chip; hostile values fall back to Growth", async ({ page }) => {
  await page.goto("/en/sign-in?mode=signup&plan=scale&billing=annual");
  const chip = page.getByTestId("trial-chip");
  await expect(chip).toContainText("7-day trial of Scale");
  await expect(chip).toContainText("then yearly");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Create your account");

  await page.goto("/en/sign-in?mode=signup&plan=%3Cscript%3E&billing=gold");
  await expect(page.getByTestId("trial-chip")).toContainText("7-day trial of Growth");
  await expect(page.getByTestId("trial-chip")).not.toContainText("yearly");
});

test("the language link keeps only the allow-listed query", async ({ page }) => {
  await page.goto("/en/sign-in?mode=signup&next=%2Fwelcome&plan=scale&x=1");
  await page.getByRole("link", { name: "عربي", exact: true }).click();
  await expect(page).toHaveURL(/\/ar\/sign-in\?next=%2Fwelcome&mode=signup&plan=scale$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByTestId("trial-chip")).toContainText("Scale");
});

test("reason banners: known reasons show, anything else shows nothing", async ({ page }) => {
  await page.goto("/en/sign-in?reason=expired");
  await expect(page.getByTestId("auth-reason")).toContainText("Your session ended.");
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByTestId("auth-reason")).toBeHidden();
  await page.goto("/en/sign-in?reason=%3Cscript%3E");
  await expect(page.getByTestId("auth-reason")).toHaveCount(0);
  await page.goto("/en/sign-in?next=%2Fintegrations%2Fshopify%2Fconnect%3Fshop%3Dnile-abayas.myshopify.com");
  await expect(page.getByTestId("auth-reason")).toContainText("nile-abayas.myshopify.com");
});

test("an invitation link sends a signed-out visitor to sign in, naming no store", async ({ page }) => {
  const id = "0b1c2d3e-0000-4000-8000-000000000000";
  await page.goto(`/en/invitations/${id}`);
  await expect(page).toHaveURL(new RegExp(`/en/sign-in\\?next=%2Fwelcome%3Finvite%3D${id}$`));
  await expect(page.getByTestId("auth-reason")).toContainText("You've been invited to a store on Mizan.");
});

test("Arabic: the dial code sits left of the number, and a wrong number never leaves the page", async ({ page }) => {
  await page.goto("/ar/sign-in");
  await page.getByRole("radio", { name: "الموبايل", exact: true }).click();
  const country = await page.getByTestId("phone-country").boundingBox();
  const input = await page.getByLabel("رقم الموبايل", { exact: true }).boundingBox();
  expect(country!.x).toBeLessThan(input!.x);
  await page.getByTestId("phone-country").click();
  await page.getByRole("option", { name: /السعودية/ }).click();
  await expect(page.getByTestId("phone-country")).toContainText("+966");
});

test("steps move focus: reset link → its form; back to the start", async ({ page }) => {
  await page.goto("/en/sign-in");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByTestId("auth-step")).toHaveAttribute("data-step", "reset");
  await expect(page.getByLabel("Work email", { exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByTestId("auth-step")).toHaveAttribute("data-step", "start");
});

test("required fields are flagged on submit, on the field", async ({ page }) => {
  await page.goto("/en/sign-in");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByText("Write your work email.")).toBeVisible();
  await expect(page.getByLabel("Work email", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Work email", { exact: true })).toHaveAttribute("aria-invalid", "true");
});

test("reduced motion: nothing keeps running on the stage or after a step change", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/en/sign-in");
  await expect(page.getByTestId("auth-stage")).toBeVisible();
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.waitForTimeout(400);
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && (a as CSSAnimation).animationName !== "au-caret").length);
  expect(running).toBe(0);
});

for (const [w, h] of [[320, 640], [390, 844], [820, 1180], [1440, 900], [844, 390]] as const) {
  test(`no sideways scroll at ${w}×${h} (AR and EN, both methods)`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    for (const l of ["ar", "en"] as const) {
      await page.goto(`/${l}/sign-in?mode=signup&plan=scale&billing=annual`);
      await page.getByRole("radio", { name: l === "ar" ? "الموبايل" : "Phone", exact: true }).click();
      for (let i = 0; i < 2; i++) {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.getByRole("radio", { name: l === "ar" ? "الإيميل" : "Email", exact: true }).click();
      }
    }
  });
}
