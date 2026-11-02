import { expect, test } from "@playwright/test";
import { ownerWithStore, signInOwner } from "./stack";

/**
 * M7-1 true ROAS in the browser. The numbers are proven in the API (attribution.e2e, roas.test);
 * here: the empty period against the real API, then a period served by the test, in Arabic.
 */
const egp = (amount: string) => ({ amount, currency: "EGP" });

test("owner in Arabic: no spend yet, then true vs reported ROAS, cost per delivered order and the days", async ({ page }) => {
  const owner = await ownerWithStore("متجر الحملات");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);

  await page.goto("/ar/profit");
  await page.getByRole("link", { name: "الإعلانات: العائد الحقيقي" }).click();
  await expect(page).toHaveURL(/\/ar\/profit\/ads$/);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("الإعلانات: العائد الحقيقي");
  await expect(main.getByText("مفيش مصروف إعلانات في الفترة دي")).toBeVisible();

  const days = Array.from({ length: 30 }, (_, i) => {
    const day = new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
    return day === "2026-10-29"
      ? { day, spend: egp("400.00"), orders: 6, delivered: 2, real: egp("2400.00"), trueRoas: "6.00" }
      : { day, spend: egp("0.00"), orders: 0, delivered: 0, real: egp("0.00"), trueRoas: null };
  });
  await page.route("**/v1/attribution/roas?*", (route) => route.fulfill({ json: {
    from: "2026-10-01", to: "2026-10-30", currency: "EGP", spend: egp("400.00"), fxMissing: false,
    trueRoas: "6.00", reportedRoas: "12.75", projectedRoas: "7.50", costPerOrder: egp("66.67"), costPerDelivered: egp("200.00"),
    deliveredRate: "66.7", lostShare: "33.3",
    orders: { placed: 6, delivered: 2, moving: 2, cancelled: 1, returned: 1 },
    money: { placed: egp("5100.00"), real: egp("2400.00"), pending: egp("900.00"), net: egp("620.00") },
    byPlatform: [{ platform: "meta", spend: egp("300.00"), share: "75.0" }, { platform: "tiktok", spend: egp("100.00"), share: "25.0" }],
    days,
  } }));
  await page.reload();
  const kpis = main.getByTestId("roas-kpis");
  await expect(kpis).toContainText("العائد الحقيقي (ROAS)");
  await expect(kpis).toContainText("6.00ضعف");
  await expect(kpis).toContainText("12.75ضعف");
  await expect(kpis).toContainText("7.50ضعف");
  await expect(kpis).toContainText("200.00");
  await expect(main.getByText(/من الـ 6 أوردر/)).toContainText("33.3٪");
  await expect(main.getByTestId("roas-days").getByRole("row")).toHaveCount(2); // the header and the one day with spend
  await expect(main.getByTestId("roas-platforms")).toContainText("ميتا");
  await expect(main.getByTestId("roas-platforms")).toContainText("75.0٪");
  await page.setViewportSize({ width: 1280, height: 1100 });
  await main.screenshot({ path: "test-results/roas-ar.png" });
});
