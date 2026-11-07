import { expect, test, type Page } from "@playwright/test";

/**
 * AU-1: the redesigned frame of the screens before a store (auth spec §10.4). Signed out only; the
 * journeys that sign in are in auth.spec.ts.
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
  // Anyone can craft a link: "your account is disabled" is never one (it is the sign-in error itself),
  // and the continue-URL notes claim nothing about the account.
  await page.goto("/en/sign-in?reason=disabled");
  await expect(page.getByTestId("auth-reason")).toHaveCount(0);
  await page.goto("/en/sign-in?reason=reset");
  await expect(page.getByTestId("auth-reason")).toContainText("If you've just changed your password");
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

test("the exit copy of a step never shows the typed password (Forgot password?)", async ({ page }) => {
  await page.goto("/en/sign-in");
  await page.getByLabel("Work email", { exact: true }).fill("owner@example.com");
  await page.getByLabel("Password").fill("hunter2-secret");
  await watchGhosts(page);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByTestId("auth-step")).toHaveAttribute("data-step", "reset");
  const copies = await ghosts(page);
  expect(copies.length).toBeGreaterThan(0);
  expect(copies.some((g) => g.value === "hunter2-secret")).toBe(false);
  expect(copies.filter((g) => g.value.includes("•")).every((g) => g.type === "password")).toBe(true);
});

test("Email/Phone: an arrow key changes the method and keeps focus on the control", async ({ page }) => {
  await page.goto("/en/sign-in");
  const email = page.getByRole("radio", { name: "Email", exact: true });
  await email.focus();
  await page.keyboard.press("ArrowRight");
  const phone = page.getByRole("radio", { name: "Phone", exact: true });
  await expect(phone).toHaveAttribute("aria-checked", "true");
  await expect(phone).toBeFocused();
  await expect(page.getByLabel("Mobile number", { exact: true })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(email).toBeFocused();
  await expect(page.getByTestId("auth-step")).toHaveAttribute("data-step", "start");
});

test("the theme menu: arrows move, a pick keeps focus on the button", async ({ page }) => {
  await page.goto("/en/sign-in");
  const button = page.getByRole("button", { name: "Theme", exact: true });
  await button.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitemradio", { checked: true })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("menuitemradio", { name: "Dark" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("the trial's Change: arrows move the plan without closing; Escape returns to Change", async ({ page }) => {
  await page.goto("/en/sign-in?mode=signup&plan=growth");
  const change = page.getByTestId("trial-chip").getByRole("button", { name: "Change" });
  await change.click();
  await expect(page.getByText("Plan for your trial")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Growth" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "Scale" })).toBeFocused();
  await expect(page.getByTestId("trial-chip")).toContainText("7-day trial of Scale");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("radiogroup", { name: "Plan for your trial" })).toHaveCount(0);
  await expect(change).toBeFocused();
});

test("the country list: small flags, one line per country, opaque", async ({ page }) => {
  await page.goto("/en/sign-in");
  await page.getByRole("radio", { name: "Phone", exact: true }).click();
  await page.getByTestId("phone-country").click();
  const options = page.getByRole("option");
  await expect(options).toHaveCount(3);
  for (const o of await options.all()) expect((await o.boundingBox())!.height).toBeLessThanOrEqual(44);
  const flag = await options.first().locator("svg.au-flag").boundingBox();
  expect(flag!.width).toBeLessThanOrEqual(20);
  const bg = await page.getByRole("listbox").evaluate((el) => getComputedStyle(el).backgroundImage + "|" + getComputedStyle(el).backgroundColor);
  expect(bg).toMatch(/gradient|rgb\(\d+, \d+, \d+\)$/);
});

test("landscape phone: the card starts below the top bar", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto("/en/sign-in");
  const bar = await page.locator(".mz-auth-bar__in").boundingBox();
  const card = await page.locator(".mz-auth-card").boundingBox();
  expect(card!.y).toBeGreaterThanOrEqual(bar!.y + bar!.height);
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
