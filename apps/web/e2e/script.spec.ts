import { expect, test } from "@playwright/test";
import { ownerWithStore, signInOwner } from "./stack";

/**
 * E6-16b in the browser, real API: the owner designs the buyer's WhatsApp chat in the studio. A
 * custom thank-you with a variable chip shows on the phone with the sample name after tapping the
 * template's Confirm; the steps reorder with the keyboard; a cancel reason is added; all of it saves.
 */
test("owner in Arabic: designs the chat in the studio, plays it on the phone and saves it", async ({ page }) => {
  test.setTimeout(120_000); // a long journey: design, play, reorder, reasons, save, reload
  await page.setViewportSize({ width: 1440, height: 1000 }); // the phone beside the flow
  const owner = await ownerWithStore("متجر الاستوديو");
  await page.goto("/ar/sign-in");
  await signInOwner(page, owner, "ar");
  await expect(page).toHaveURL(/\/ar$/);
  await page.goto("/ar/settings/confirmation");
  await page.getByTestId("studio-card").getByRole("link", { name: "افتح الاستوديو" }).click();
  await expect(page).toHaveURL(/\/ar\/settings\/confirmation\/studio$/);
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("استوديو التأكيد");
  await expect(page.getByRole("navigation", { name: "الإعدادات" }).getByRole("link", { name: "الاستوديو" })).toHaveAttribute("aria-current", "page");

  // The phone starts with the approved template alone.
  const phone = main.getByTestId("whatsapp-phone");
  await expect(phone).toContainText("أوردرك رقم #1001");
  await expect(phone).toContainText("قالب معتمد");

  // Confirms: own words with the customer's name dropped in from its chip. Picking the node plays
  // the Confirm chat on the phone, so its reply is on screen while it is edited.
  await main.getByTestId("node-confirms").click();
  await expect(phone.getByRole("button", { name: /عدّل الرسالة دي/ }).first()).toBeVisible();
  const confirmed = main.getByLabel("الشكر بعد التأكيد");
  await confirmed.fill("تمام يا ");
  await main.getByTestId("key-confirmed").getByRole("button", { name: "حط اسم العميل الأول" }).click();
  await expect(confirmed).toHaveValue("تمام يا {{customer.first_name}}");
  await confirmed.press("End");
  await confirmed.pressSequentially(" أوردرك اتأكّد 🎉");
  await expect(confirmed).toHaveValue("تمام يا {{customer.first_name}} أوردرك اتأكّد 🎉");
  await expect(main.getByTestId("key-confirmed").getByTestId("counter")).toContainText("من 1000");

  // The store's reply with the sample name, live; Confirm again on the template gets no new reply.
  await expect(phone).toContainText("تمام يا منى أوردرك اتأكّد 🎉");
  await phone.getByRole("button", { name: "أكّد الأوردر" }).click();
  await expect(phone.locator("li", { hasText: "تمام يا منى أوردرك اتأكّد 🎉" })).toHaveCount(1);
  // The bubble opens its text: clicking it focuses the field.
  await confirmed.blur();
  await phone.getByRole("button", { name: /عدّل الرسالة دي: تمام يا منى/ }).click();
  await expect(confirmed).toBeFocused();

  // Reorder with the keyboard: add an automated call, then lift it above WhatsApp.
  await main.getByRole("button", { name: "ضيف خطوة: مكالمة تلقائية" }).click();
  const names = main.getByTestId("step-name");
  await expect(names).toHaveText(["رسالة واتساب", "مكالمة تلقائية", "مكالمة من الفريق"]);
  const handle = main.getByRole("button", { name: "حرّك الخطوة 2: مكالمة تلقائية" });
  await handle.focus();
  // dnd-kit measures the list on lift: a beat between the keys, as a person would.
  await page.keyboard.press("Space");
  await page.waitForTimeout(200);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(200);
  await page.keyboard.press("Space");
  await expect(names).toHaveText(["مكالمة تلقائية", "رسالة واتساب", "مكالمة من الفريق"]);

  // Cancels: the store's own reasons, one more of its own.
  await main.getByTestId("node-cancel").click();
  const reasons = main.getByTestId("reasons");
  await reasons.getByRole("button", { name: "عدّل الأسباب" }).click();
  const before = await reasons.getByTestId("reason-row").count();
  await reasons.getByRole("button", { name: "ضيف سبب" }).click();
  await expect(reasons.getByTestId("reason-row")).toHaveCount(before + 1);
  await reasons.getByLabel(`السبب ${before + 1}`, { exact: true }).fill("المقاس مش مظبوط");
  await expect(reasons.getByLabel(`السبب ${before + 1}`, { exact: true })).toHaveValue("المقاس مش مظبوط");
  // Its English title too: without it the buyer would read the style's title for "other" twice.
  await main.getByRole("radio", { name: "الإنجليزي" }).click();
  await reasons.getByLabel(`السبب ${before + 1}`, { exact: true }).fill("Wrong size");
  await main.getByRole("radio", { name: "العربي" }).click();

  await page.getByRole("button", { name: "احفظ" }).click();
  await expect(page.locator(".mz-toast")).toContainText("اتحفظ");

  await page.reload();
  await main.getByTestId("node-confirms").click();
  await expect(main.getByLabel("الشكر بعد التأكيد")).toHaveValue("تمام يا {{customer.first_name}} أوردرك اتأكّد 🎉");
  await expect(main.getByTestId("step-name")).toHaveText(["مكالمة تلقائية", "رسالة واتساب", "مكالمة من الفريق"]);
  await main.getByTestId("node-cancel").click();
  await expect(main.getByTestId("reasons").getByLabel(`السبب ${before + 1}`, { exact: true })).toHaveValue("المقاس مش مظبوط");
  // The cancel list on the phone has the new reason.
  await phone.getByRole("button", { name: "ألغي الأوردر" }).click();
  await phone.locator("button[aria-haspopup=dialog]").click(); // the list button inside the bubble
  await expect(phone.getByTestId("list-sheet")).toContainText("المقاس مش مظبوط");
  await page.keyboard.press("Escape");
  await expect(phone.getByTestId("list-sheet")).toHaveCount(0);
  await main.screenshot({ path: "test-results/studio-ar.png" });
});

test("owner in English: the studio reads left to right; the phone opens as a sheet on a phone-sized screen", async ({ page }) => {
  const owner = await ownerWithStore("Studio Store");
  await page.goto("/en/sign-in");
  await signInOwner(page, owner, "en");
  await expect(page).toHaveURL(/\/en$/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/en/settings/confirmation/studio");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  const main = page.getByRole("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Confirmation studio");
  await expect(main.getByTestId("flow-branches")).toContainText("What the buyer can do in the chat");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); // no sideways scroll
  await page.getByTestId("open-phone").click();
  const dialog = page.getByRole("dialog", { name: "The buyer's WhatsApp" });
  await expect(dialog.getByTestId("whatsapp-phone")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).first().click();
  await expect(dialog).toBeHidden();
});
