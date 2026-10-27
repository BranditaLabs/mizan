import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { agentIn, mizan, newPhone, ownerWithStore, signInOwner, signInWithPhone } from "./stack";

const placeOrder = (owner: { token: string; storeId: string }) => mizan(owner.token, "POST", "/orders", {
  source: "phone", customer: { name: "منى عادل", phone: "01001234821" }, address: { line1: "12 شارع عباس العقاد", city: "مدينة نصر" },
  lines: [{ title: "عباية سادة", quantity: 1, unitPrice: "1000" }], shipping: "0", payment: { mode: "cod" },
}, owner.storeId);

/** E15-2 in the browser: the owner's dashboards, the period, and an Excel and a CSV download. */
test("owner in Arabic: dashboards from the metric layer, downloaded as Excel and CSV", async ({ page }) => {
  const owner = await ownerWithStore("متجر التقارير");
  await placeOrder(owner);
  await placeOrder(owner);
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await page.getByRole("link", { name: "التقارير" }).click();
  await expect(page).toHaveURL(/\/ar\/reports$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("التقارير");
  const tabs = page.getByRole("tablist", { name: "اللوحات" });
  await expect(tabs.getByRole("tab")).toHaveText(["نظرة عامة", "التشغيل", "الأرباح", "المدفوعات", "المخزون"]);
  const home = page.getByTestId("dashboard-home");
  await expect(home.getByTestId("tiles")).toContainText("2");
  await expect(home.getByTestId("series-orders")).toContainText("الإجمالي 2");
  await page.getByRole("button", { name: "آخر 7 يوم" }).click();
  await expect(home.getByTestId("series-orders").getByRole("table").getByRole("row")).toHaveCount(8);

  const [xlsx] = await Promise.all([page.waitForEvent("download"), home.getByRole("button", { name: "ملف Excel" }).click()]);
  expect(xlsx.suggestedFilename()).toMatch(/^mizan-home-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.xlsx$/);
  expect((await readFile((await xlsx.path())!)).subarray(0, 2).toString()).toBe("PK");
  const [csv] = await Promise.all([page.waitForEvent("download"), home.getByRole("button", { name: "ملف CSV" }).click()]);
  const text = (await readFile((await csv.path())!)).toString("utf8");
  expect(text.charCodeAt(0)).toBe(0xfeff);
  expect(text).toContain("نظرة عامة");

  await tabs.getByRole("tab", { name: "التشغيل" }).click();
  await expect(page.getByTestId("dashboard-operations")).toBeVisible();
});

/** An agent sees only the dashboards with a number they may see, and no profit. */
test("agent in Arabic: no profit dashboard, no profit series", async ({ page }) => {
  const phone = newPhone();
  await agentIn(phone, "متجر تقارير الفريق");
  await page.goto("/ar/sign-in");
  await signInWithPhone(page, phone, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await page.goto("/ar/reports");
  await expect(page.getByRole("tablist", { name: "اللوحات" }).getByRole("tab")).toHaveText(["نظرة عامة", "التشغيل", "المدفوعات", "المخزون"]);
  const home = page.getByTestId("dashboard-home");
  await expect(home.getByTestId("series-orders")).toBeVisible();
  await expect(home.getByTestId("series-net_profit")).toHaveCount(0);
  await expect(home.getByTestId("tiles")).not.toContainText("صافي الربح");
});
