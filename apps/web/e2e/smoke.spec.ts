import { expect, test, type Page } from "@playwright/test";

const bodyBg = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const LIGHT_BG = "rgb(241, 242, 244)"; // --bg #F1F2F4
const DARK_BG = "rgb(11, 13, 17)"; // --bg #0B0D11

function watch(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("request", (r) => { if (!r.url().startsWith("http://localhost:3100")) problems.push(`external request: ${r.url()}`); });
  return problems;
}

test("Arabic is the default: / → /ar, right-to-left, Arabic copy, isolated numbers", async ({ browser }) => {
  // A browser in a language we do not serve falls back to Arabic.
  const context = await browser.newContext({ locale: "de-DE", extraHTTPHeaders: { "Accept-Language": "de-DE,de;q=0.9" } });
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/ar$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
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
  // Direction icons mirror in Arabic.
  expect(await page.locator("svg.rtl\\:-scale-x-100").evaluate((el) => getComputedStyle(el).scale)).toBe("-1 1");
  // The rail sits on the start side: the right in Arabic.
  const rail = await page.locator("aside").boundingBox();
  expect(rail!.x).toBeGreaterThan(page.viewportSize()!.width / 2);
  await page.screenshot({ path: "test-results/home-ar.png", fullPage: true });
  expect(problems).toEqual([]);
  await context.close();
});

test("English from the browser language, and the switch remembers the choice", async ({ browser }) => {
  const context = await browser.newContext({ locale: "en-US", extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" } });
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto("/");
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  const rail = await page.locator("aside").boundingBox();
  expect(rail!.x).toBeLessThan(10); // start side: the left in English
  expect(await page.locator("svg.rtl\\:-scale-x-100").evaluate((el) => getComputedStyle(el).scale)).toBe("none");
  await page.screenshot({ path: "test-results/home-en.png", fullPage: true });

  await page.getByRole("button", { name: "عربي" }).click();
  await expect(page).toHaveURL(/\/ar$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.goto("/");
  await expect(page).toHaveURL(/\/ar$/); // cookie beats Accept-Language
  expect(problems).toEqual([]);
  await context.close();
});

test("theme: chosen theme applies at once and is server-rendered on the next visit", async ({ page, request }) => {
  await page.goto("/en");
  expect(await bodyBg(page)).toBe(LIGHT_BG);
  await page.getByRole("button", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await bodyBg(page)).toBe(DARK_BG);

  const html = await (await request.get("/en", { headers: { Cookie: "mizan-theme=dark" } })).text();
  expect(html).toMatch(/<html[^>]*data-theme="dark"/);
  await page.reload();
  expect(await bodyBg(page)).toBe(DARK_BG);

  await page.getByRole("button", { name: "System" }).click();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", /.+/);
});

test("system dark mode is followed when no theme was chosen", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const page = await context.newPage();
  await page.goto("/ar");
  expect(await bodyBg(page)).toBe(DARK_BG);
  await page.getByRole("button", { name: "فاتح" }).click();
  expect(await bodyBg(page)).toBe(LIGHT_BG);
  await context.close();
});

test("security headers on every page", async ({ request }) => {
  const res = await request.get("/ar");
  expect(res.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(res.headers()["x-content-type-options"]).toBe("nosniff");
  expect(res.headers()["x-powered-by"]).toBeUndefined();
});
