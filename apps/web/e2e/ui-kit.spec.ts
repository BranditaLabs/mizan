import { expect, test, type Page } from "@playwright/test";

/**
 * The UI kit (E4-3) in a real browser, on the /ui gallery: keyboard paths in both directions,
 * table sorting and selection, dialogs and drawers (focus in, Esc, focus back), menu, combobox,
 * toasts. Screenshots in both languages and themes for design review.
 */
function watch(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(e.message));
  return problems;
}

const firstColumn = (page: Page, header: string) =>
  page.locator("table tbody tr").evaluateAll((rows, h) => {
    const table = rows[0]!.closest("table")!;
    const i = [...table.querySelectorAll("thead th")].findIndex((th) => th.textContent?.trim() === h);
    return rows.map((r) => r.querySelectorAll("td")[i]!.textContent!.replace(/\s+/g, " ").trim());
  }, header);

test("gallery in Arabic: right to left, tabs follow the screen, combobox finds Arabic spellings", async ({ page }) => {
  const problems = watch(page);
  await page.goto("/ar/ui");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("مكونات الواجهة");

  // Tabs: one tab stop; in Arabic, ArrowLeft goes to the next tab (it is on the left).
  const all = page.getByRole("tab", { name: /الكل/ });
  await all.click();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: /محتاج تأكيد/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: /محتاج تأكيد/ })).toBeFocused();
  await expect(page.locator("table tbody tr")).toHaveCount(2);
  await page.keyboard.press("ArrowRight");
  await expect(all).toHaveAttribute("aria-selected", "true");

  // Combobox: "اسكندريه" (no hamza, taa marbuta as haa) finds "الإسكندرية".
  const city = page.getByRole("combobox", { name: "المدينة" });
  const cities = page.getByRole("listbox", { name: "المدينة" }).getByRole("option");
  await city.fill("بورسعيد");
  await expect(cities).toHaveText(["بورسعيد"]);
  await city.fill("اسكندريه");
  await expect(cities).toHaveText(["الإسكندرية"]);
  await page.keyboard.press("Enter");
  await expect(city).toHaveValue("الإسكندرية");
  await city.fill("xyz");
  await expect(page.getByRole("listbox")).toContainText("مفيش مدينة بالاسم ده");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();

  // Drawer opens at the inline end: the left in Arabic. Masked phone, revealed on request.
  await page.getByRole("button", { name: "افتح كدرج" }).click();
  const drawer = page.getByRole("dialog", { name: "أوردر #EO-48213" });
  await expect(drawer).toBeVisible();
  const box = await drawer.boundingBox();
  expect(box!.x).toBeLessThan(5);
  await expect(drawer.getByText("+20 ••• 4821")).toBeVisible();
  await drawer.getByRole("button", { name: "اعرض الرقم" }).click();
  await expect(drawer.getByText("+201001234821")).toBeVisible();
  await page.screenshot({ path: "test-results/ui-ar-drawer.png" });
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("button", { name: "افتح كدرج" })).toBeFocused();

  // Switch: a real switch for assistive tech.
  const sw = page.getByRole("switch", { name: /بلّغني/ });
  await expect(sw).not.toBeChecked();
  await sw.click();
  await expect(sw).toBeChecked();

  await page.screenshot({ path: "test-results/ui-ar.png", fullPage: true });
  expect(problems).toEqual([]);
});

test("table: sort, select, bulk action with toast and undo, menu and confirmation dialog", async ({ page }) => {
  const problems = watch(page);
  await page.goto("/en/ui");
  const table = page.getByRole("table", { name: "Sample orders" });

  // Sort by total: ascending, then descending; empty sort state is "none".
  const total = table.getByRole("columnheader", { name: "Total" });
  await expect(total).toHaveAttribute("aria-sort", "none");
  await total.getByRole("button").click();
  await expect(total).toHaveAttribute("aria-sort", "ascending");
  expect((await firstColumn(page, "Total"))[0]).toBe("EGP 640.50");
  await total.getByRole("button").click();
  await expect(total).toHaveAttribute("aria-sort", "descending");
  expect((await firstColumn(page, "Total"))[0]).toBe("EGP 12,500.00");

  // Select two rows: the header checkbox is mixed, the bulk bar names the action.
  await table.getByRole("checkbox", { name: "Select order EO-48213" }).check();
  await table.getByRole("checkbox", { name: "Select order EO-48212" }).check();
  expect(await table.getByRole("checkbox", { name: "Select all rows" }).evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(true);
  await expect(table.locator('tr[aria-selected="true"]')).toHaveCount(2);
  const bulk = page.getByRole("region", { name: "Actions on selected rows" });
  await expect(bulk).toContainText("2 selected");

  // Menu: keyboard opens, arrows move, Esc returns focus to the trigger.
  const more = bulk.getByRole("button", { name: "More actions" });
  await more.focus();
  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "More actions" });
  await expect(menu.getByRole("menuitem", { name: "Add a tag" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(menu.getByRole("menuitem", { name: "Cancel orders" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();

  // Bulk action → toast in the past tense, with Undo.
  await bulk.getByRole("button", { name: "Ship 2 orders" }).click();
  await expect(bulk).toBeHidden();
  const toast = page.locator(".mz-toast").filter({ hasText: "2 orders shipped with Bosta" });
  await expect(toast).toBeVisible();
  await toast.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".mz-toast").filter({ hasText: "Shipping undone" })).toBeVisible();

  // Destructive confirmation: names the order and the consequence; the safe button has focus; Esc closes.
  const opener = page.getByRole("button", { name: "Cancel an order…" });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Cancel order #EO-48213?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Bosta will be asked to stop the delivery");
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.click();
  await dialog.getByRole("button", { name: "Cancel order" }).click();
  await expect(page.locator(".mz-toast").filter({ hasText: "Order #EO-48213 cancelled" })).toBeVisible();
  expect(problems).toEqual([]);
});

test("gallery in English, dark theme: screenshot and contrast-safe hero tile", async ({ browser }) => {
  const context = await browser.newContext({ colorScheme: "dark" });
  const page = await context.newPage();
  const problems = watch(page);
  await page.goto("/en/ui");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  // The hero KPI inverts in dark: paper tile, ink text (--mz-primary / --mz-on-primary).
  const hero = page.locator(".mz-kpi--hero");
  await expect(hero).toHaveCSS("background-color", "rgb(247, 243, 248)");
  await expect(hero.getByRole("img", { name: "Trend over 14 days" })).toBeVisible();
  await expect(page.getByRole("meter", { name: "Risk 82 of 100" }).first()).toBeVisible();
  // A switch that is on keeps a visible knob on the paper-coloured track.
  const on = page.getByRole("switch", { checked: true }).first();
  const [track, knob] = await on.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el, "::after").backgroundColor]);
  expect(knob).not.toBe(track);
  await page.screenshot({ path: "test-results/ui-en-dark.png", fullPage: true });
  expect(problems).toEqual([]);
  await context.close();
});
