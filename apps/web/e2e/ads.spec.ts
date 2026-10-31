import { expect, test } from "@playwright/test";
import { ownerWithStore, signInOwner } from "./stack";

/**
 * E9-3 Settings → Ad spend in the browser. The split over orders, FX and CSV rules are tested in
 * the API (ad-spend.e2e, ad-spend-csv); here: the page in Arabic against the real API (no store
 * connected in this stack, so saving says to connect one), then a store's month served by the
 * test, and a CSV with bad lines named one by one.
 */
const egp = (amount: string) => ({ amount, currency: "EGP" });

test("owner in Arabic: an empty month, saving without a store, then days, shares and a CSV's bad lines", async ({ page }) => {
  const owner = await ownerWithStore("متجر الإعلانات");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);

  await page.goto("/ar/settings/ads");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("مصاريف الإعلانات");
  await expect(main.getByRole("link", { name: "مصاريف الإعلانات" })).toHaveAttribute("aria-current", "page");
  await expect(main.getByText("مفيش صرف في آخر 30 يوم.")).toBeVisible();

  const add = main.getByTestId("ad-add");
  await add.getByLabel("المبلغ").fill("٢٥٠٠");
  await add.getByRole("button", { name: "احفظ" }).click();
  await expect(page.locator(".mz-toast")).toContainText("اربط متجرك الأول");

  // A store's month, served by the test.
  const cid = "55555555-5555-4555-8555-555555555555";
  await page.route("**/v1/ad-spend", (route) => route.request().method() === "GET" ? route.fulfill({ json: {
    from: "2026-09-24", to: "2026-10-23", baseCurrency: "EGP", total: egp("3075.00"), unallocated: egp("75.00"),
    byPlatform: [{ platform: "meta", spend: egp("2500.00") }, { platform: "tiktok", spend: egp("575.00") }],
    days: [
      { day: "2026-10-22", connectionId: cid, spend: egp("3000.00"), orders: 12, perOrder: egp("250.00"), fxMissing: false },
      { day: "2026-10-20", connectionId: cid, spend: egp("75.00"), orders: 0, perOrder: null, fxMissing: false },
    ],
    data: [
      { day: "2026-10-22", platform: "meta", campaign: "Abayas", spend: egp("2500.00"), source: "csv", connectionId: cid, updatedAt: "2026-10-23T08:00:00.000Z" },
      { day: "2026-10-22", platform: "tiktok", campaign: null, spend: egp("500.00"), source: "manual", connectionId: cid, updatedAt: "2026-10-23T08:00:00.000Z" },
      { day: "2026-10-20", platform: "tiktok", campaign: null, spend: egp("75.00"), source: "manual", connectionId: cid, updatedAt: "2026-10-23T08:00:00.000Z" },
    ],
  } }) : route.continue());
  await page.route("**/v1/ad-spend/import", (route) => route.fulfill({ status: 422, contentType: "application/problem+json", json: {
    type: "about:blank", title: "في سطور في الملف ماتقريتش", status: 422, code: "csv_invalid", detail: "2 line(s) could not be read; nothing was saved",
    errors: [{ path: "line:3", code: "platform", message: "myspace" }, { path: "line:4", code: "future", message: "2026-10-30" }],
  } }));
  await page.reload();
  await expect(main.getByTestId("ad-summary")).toContainText("3,075");
  await expect(main.getByTestId("ad-summary")).toContainText("تيك توك");
  await expect(main.getByRole("table", { name: "حسب اليوم" })).toContainText("250");
  await expect(main.getByRole("table", { name: "حسب اليوم" })).toContainText("مفيش أوردرات");
  await expect(main.getByRole("table", { name: "اللي اتسجّل" })).toContainText("Abayas");
  await expect(main.getByRole("button", { name: /امسح صرف تيك توك/ }).first()).toBeVisible();

  const imp = main.getByTestId("ad-import");
  await imp.getByLabel("أو الصقه هنا").fill("date,platform,spend\n2026-10-22,meta,150\n2026-10-22,myspace,10\n2026-10-30,meta,5");
  await imp.getByRole("button", { name: "استورد" }).click();
  const errors = imp.getByTestId("ad-import-errors");
  await expect(errors).toContainText("منصة مش معروفة");
  await expect(errors).toContainText("myspace");
  await expect(errors).toContainText("في المستقبل");
  await expect(imp).toContainText("مفيش حاجة اتحفظت");
});
