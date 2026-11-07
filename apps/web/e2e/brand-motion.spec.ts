import { expect, test, type Page } from "@playwright/test";
import { ownerWithStore, signInOwner } from "./stack";

/**
 * Brand 2.0 behaviour on whole pages (docs/16 §9): red appears once per view, and reduced motion
 * leaves nothing travelling. The unit tests check one budget at a time; these check the page as a
 * whole (toasts, the loaders, verdict dots, swatches and the logo files together).
 */

// The brand red in both themes (tokens: --mz-red #DE0000, --mz-red-ink #E33232, dark --mz-brand #EA4643).
const REDS = ["rgb(222, 0, 0)", "rgb(227, 50, 50)", "rgb(234, 70, 67)"];

/** Every visible element painted in the brand red (fill, stroke, background, text), plus full-colour logo files. */
async function redsOnPage(page: Page): Promise<string[]> {
  return page.evaluate((reds) => {
    const hits: string[] = [];
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0;
    };
    for (const el of Array.from(document.querySelectorAll("body *"))) {
      if (!visible(el)) continue;
      const s = getComputedStyle(el);
      const painted = [s.fill, s.stroke, s.backgroundColor].some((c) => reds.includes(c)) || (reds.includes(s.color) && (el.textContent ?? "").trim() !== "" && el.children.length === 0);
      if (painted) hits.push(el.closest("[data-mz-red],[data-testid]")?.getAttribute("data-testid") ?? el.tagName.toLowerCase());
    }
    // A full-colour logo file carries the red dot (the -mono-* files do not).
    for (const img of Array.from(document.querySelectorAll("img[src*='/brand/']"))) {
      if (visible(img) && !/-mono-/.test(img.getAttribute("src") ?? "")) hits.push(`logo:${img.getAttribute("src")}`);
    }
    return hits;
  }, REDS);
}

/** At most one red thing per view (it may be none: the red is earned, never decoration). */
async function expectRedOnce(page: Page, where: string) {
  // Let a DROP finish its ripple and hand the red back first.
  await page.waitForTimeout(2500);
  const hits = await redsOnPage(page);
  expect(new Set(hits).size, `${where}: ${hits.join(", ")}`).toBeLessThanOrEqual(1);
}

test("red once per view: sign-in, home, payments, stock (Arabic, light and dark)", async ({ browser }) => {
  const owner = await ownerWithStore("متجر الأحمر");
  for (const colorScheme of ["light", "dark"] as const) {
    const context = await browser.newContext({ colorScheme });
    const page = await context.newPage();
    await page.goto("/ar/sign-in");
    await expectRedOnce(page, `sign-in ${colorScheme}`);
    await signInOwner(page, owner, "ar");
    await expect(page).toHaveURL(/\/ar$/);
    await expectRedOnce(page, `home ${colorScheme}`);
    for (const path of ["/ar/payments", "/ar/stock"]) {
      await page.goto(path);
      await expect(page.getByRole("main")).toBeVisible();
      await expectRedOnce(page, `${path} ${colorScheme}`);
    }
    await context.close();
  }
});

test("reduced motion: nothing travels, only short crossfades", async ({ browser }) => {
  const owner = await ownerWithStore("متجر هادي");
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  for (const path of ["/ar", "/ar/payments", "/ar/stock"]) {
    await page.goto(path);
    await expect(page.getByRole("main")).toBeVisible();
    await page.waitForTimeout(500);
    // CSS animations still running are crossfades of at most 120 ms (tokens motion.reduced), never a loop.
    const long = await page.evaluate(() => document.getAnimations().filter((a) => {
      const t = a.effect?.getComputedTiming();
      return a.playState === "running" && (t?.iterations === Infinity || Number(t?.duration ?? 0) > 120);
    }).map((a) => (a as CSSAnimation).animationName ?? "animation"));
    expect(long, path).toEqual([]);
    // The shared motion clock asks for no frames: two reads of every loader's SVG are the same.
    const frame = () => page.evaluate(() => Array.from(document.querySelectorAll("svg [data-k]")).map((e) => e.outerHTML).join(""));
    const a = await frame();
    await page.waitForTimeout(300);
    expect(await frame(), path).toBe(a);
  }
  await context.close();
});
