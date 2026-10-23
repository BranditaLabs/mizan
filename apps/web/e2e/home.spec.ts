import { expect, test } from "@playwright/test";
import { ownerWithStore, signInOwner } from "./stack";

/**
 * E9-4 the profit home. The numbers are computed and tested in the API (home.test,
 * profit-home.e2e); this stack has no store orders, so a new store sees the welcome, and a
 * store's month is served by the test.
 */
const egp = (amount: string) => ({ amount, currency: "EGP" });
const days = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 8, 24 + i)).toISOString().slice(0, 10);
  const v = i === 27 ? -190 : Math.round(3000 + Math.sin(i) * 1800);
  return { day: d, orders: 40 + (i % 7), net: egp(`${(v * 0.6).toFixed(2)}`), expectedNet: egp(`${v.toFixed(2)}`) };
});
const MONTH = {
  baseCurrency: "EGP", today: "2026-10-23", from: "2026-09-24", to: "2026-10-23", days: 30,
  yesterday: { day: "2026-10-22", orders: 46, revenue: egp("18400.00"), net: egp("-2100.00"), expectedNet: egp("6900.00") },
  period: {
    orders: 1284, revenue: egp("1420000.00"), net: egp("238700.00"), expectedNet: egp("291000.00"), fixedCosts: egp("24000.00"), unallocatedAds: egp("2300.00"),
    kept: egp("212400.00"), expectedKept: egp("264700.00"), margin: "15.0", keptPer100: egp("14.96"), previousKept: egp("196300.00"), change: "8.2",
    delivered: 1003, returned: 162, deliveryRate: "86.1", refusalLoss: egp("61000.00"), adSpend: egp("298200.00"),
    breakdown: {
      revenue: egp("1420000.00"), productCost: egp("582200.00"), shippingAndCod: egp("170400.00"), ads: egp("298200.00"), returns: egp("61000.00"),
      team: egp("32700.00"), fees: egp("39100.00"), fixed: egp("24000.00"), kept: egp("212400.00"),
    },
  },
  cash: { inTransit: egp("143000.00"), inTransitOrders: 211, awaitingRemittance: egp("41000.00"), awaitingRemittanceOrders: 64 },
  trend: days,
  leaks: [
    { kind: "refusals", count: 162, amount: egp("61000.00") },
    { kind: "losing_orders", count: 37, amount: egp("8200.00") },
    { kind: "unallocated_ads", count: 1, amount: egp("2300.00") },
    { kind: "cost_missing", count: 12, amount: null },
  ],
};

test("a new store sees the welcome, not a page of zeros", async ({ page }) => {
  const owner = await ownerWithStore("متجر جديد للربح");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await expect(page.getByRole("main").getByText("لسه مفيش أوردرات")).toBeVisible();
  await expect(page.getByTestId("profit-home")).toHaveCount(0);
});

for (const [locale, theme] of [["ar", "light"], ["en", "dark"]] as const) {
  test(`a store's month in ${locale} (${theme}): what was kept, where it went, cash and leaks`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    const owner = await ownerWithStore(`Profit Home ${locale}`);
    await page.route("**/v1/profit/home**", (route) => route.fulfill({ json: MONTH }));
    await page.goto(`/${locale}/sign-in`);
    await signInOwner(page, owner, locale);
    await expect(page).toHaveURL(new RegExp(`/${locale}$`));
    const home = page.getByTestId("profit-home");
    await expect(home.getByTestId("kept")).toContainText("212,400");
    await expect(home.getByTestId("breakdown").getByRole("listitem")).toHaveCount(8);
    await expect(home.getByTestId("kpis")).toContainText("86.1");
    await expect(home.getByTestId("leaks").getByRole("link")).toHaveCount(4);
    await page.setViewportSize({ width: 1280, height: 1800 });
    await page.screenshot({ path: `test-results/home-${locale}-${theme}.png` });
    if (locale === "ar") {
      await expect(home.getByTestId("kept")).toContainText("من كل");
      await expect(home.getByTestId("leaks")).toContainText("162 أوردر اترفضوا");
      await home.getByTestId("leaks").getByRole("link").nth(3).click();
      await expect(page).toHaveURL(/\/ar\/onboarding$/);
    } else {
      await expect(home.getByTestId("kept")).toContainText("Of every");
      await expect(home.getByTestId("expected")).toContainText("264,700");
    }
  });
}
