import { expect, test, type Page } from "@playwright/test";
import { API, EMULATOR, WEB } from "./env.mjs";
import { agentIn, newPhone, signInWithPhone } from "./stack";

const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
// packages/design-system tokens: paper #FEF7FF (light) and ink #0B0B0B (dark).
const LIGHT_BG = "rgb(254, 247, 255)";
const DARK_BG = "rgb(11, 11, 11)";
const flip = (page: Page) => page.locator("main .mz-rtl-flip").first().evaluate((el) => getComputedStyle(el).transform);

// The Auth emulator does not implement the reCAPTCHA Enterprise config probe (501); Firebase falls back. Emulator only.
const EMULATOR_PROBE = `${EMULATOR}/identitytoolkit.googleapis.com/v2/recaptchaConfig`;
const EMULATOR_PROBE_LOG = "Failed to load resource: the server responded with a status of 501 (Not Implemented)";

function watch(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && m.text() !== EMULATOR_PROBE_LOG) problems.push(m.text()); });
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().startsWith(EMULATOR_PROBE)) problems.push(`${r.status()} ${r.request().method()} ${r.url()}`); });
  page.on("pageerror", (e) => problems.push(e.message));
  // Only this app, the API and the Auth emulator: no fonts, scripts or reCAPTCHA from elsewhere.
  page.on("request", (r) => { if (![WEB, API, EMULATOR].some((o) => r.url().startsWith(o))) problems.push(`external request: ${r.url()}`); });
  return problems;
}

test("Arabic is the default: / → /ar, right-to-left, Arabic copy, isolated numbers", async ({ browser }) => {
  const phone = newPhone();
  await agentIn(phone, "متجر الاختبار");
  // A browser in a language we do not serve falls back to Arabic.
  const context = await browser.newContext({ locale: "de-DE", extraHTTPHeaders: { "Accept-Language": "de-DE,de;q=0.9" } });
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/ar\/sign-in\?next=%2F$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.locator("header img").first()).toHaveAttribute("alt", "ميزان");
  await signInWithPhone(page, phone, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("أهلًا بيك في ميزان");
  const example = page.getByTestId("example");
  const orderId = example.locator("bdi").first();
  await expect(orderId).toHaveText("#1042");
  await expect(orderId).toHaveAttribute("dir", "ltr");
  // Laid out "#1042", not "1042#": the "#" sits left of the first digit inside the Arabic sentence.
  const [hashX, oneX] = await orderId.evaluate((el) => [0, 1].map((i) => {
    const r = document.createRange();
    r.setStart(el.firstChild!, i);
    r.setEnd(el.firstChild!, i + 1);
    return r.getBoundingClientRect().x;
  }));
  expect(hashX).toBeLessThan(oneX!);
  await expect(example).toContainText("1,150.00");
  // Direction icons mirror in Arabic (design system .mz-rtl-flip).
  expect(await flip(page)).toBe("matrix(-1, 0, 0, 1, 0, 0)");
  // Brand: the Arabic wordmark on the ink rail, fonts from the design system (self-hosted).
  await expect(page.locator("aside img")).toHaveAttribute("src", "/brand/mizan-wordmark-ar-on-dark.svg");
  await expect(page.locator("aside img")).toHaveAttribute("alt", "ميزان");
  expect(await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check("14px 'IBM Plex Sans Arabic'", "ميزان"); })).toBe(true);
  // The rail sits on the start side: the right in Arabic.
  const rail = await page.locator("aside").boundingBox();
  expect(rail!.x).toBeGreaterThan(page.viewportSize()!.width / 2);
  await page.screenshot({ path: "test-results/home-ar.png", fullPage: true });
  expect(problems).toEqual([]);
  await context.close();
});

test("English from the browser language, and the switch remembers the choice", async ({ browser }) => {
  const phone = newPhone();
  await agentIn(phone, "Test Store");
  const context = await browser.newContext({ locale: "en-US", extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" } });
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/en\/sign-in\?next=%2F$/);
  await signInWithPhone(page, phone, "en");
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  const rail = await page.locator("aside").boundingBox();
  expect(rail!.x).toBeLessThan(10); // start side: the left in English
  expect(await flip(page)).toBe("none");
  await expect(page.locator("aside img")).toHaveAttribute("src", "/brand/mizan-wordmark-on-dark.svg");
  expect(await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check("14px Geist"); })).toBe(true);
  expect(await page.locator("h1").evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/^"?Geist"?/);
  await page.screenshot({ path: "test-results/home-en.png", fullPage: true });
  await page.getByRole("button", { name: "Dark" }).click();
  // Pressed segments are ink-on-paper inverted in dark (--mz-primary #F7F3F8); wait out the colour transition.
  await expect(page.getByRole("button", { name: "Dark" })).toHaveCSS("background-color", "rgb(247, 243, 248)");
  await page.screenshot({ path: "test-results/home-en-dark.png", fullPage: true });
  await page.getByRole("button", { name: "System" }).click();

  await page.getByRole("button", { name: "عربي" }).click();
  await expect(page).toHaveURL(/\/ar$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.goto("/");
  await expect(page).toHaveURL(/\/ar$/); // cookie beats Accept-Language
  expect(problems).toEqual([]);
  await context.close();
});

test("theme: chosen theme applies at once and is server-rendered on the next visit", async ({ page, request }) => {
  await page.goto("/en/sign-in");
  expect(await bodyBg(page)).toBe(LIGHT_BG);
  await page.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await bodyBg(page)).toBe(DARK_BG);

  const html = await (await request.get("/en/sign-in", { headers: { Cookie: "mizan-theme=dark" } })).text();
  expect(html).toMatch(/<html[^>]*data-theme="dark"/);
  await page.reload();
  expect(await bodyBg(page)).toBe(DARK_BG);

  await page.getByRole("button", { name: "System" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
});

test("system dark mode is followed when no theme was chosen", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const page = await context.newPage();
  await page.goto("/ar/sign-in");
  expect(await bodyBg(page)).toBe(DARK_BG);
  await page.getByRole("button", { name: "فاتح" }).click();
  expect(await bodyBg(page)).toBe(LIGHT_BG);
  await context.close();
});

test("security headers on every page", async ({ request }) => {
  const res = await request.get("/ar/sign-in");
  expect(res.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["x-powered-by"]).toBeUndefined();
});
