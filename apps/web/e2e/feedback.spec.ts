import { expect, test } from "@playwright/test";
import { ownerWithStore, signInOwner } from "./stack";

/** L1-8 in the browser: feedback from the header, with the page the person is on (path only). */
test("owner in English: sends a problem from the header with the page", async ({ page }) => {
  const owner = await ownerWithStore("Feedback Store");
  await page.goto("/en/sign-in");
  await signInOwner(page, owner, "en");
  await expect(page).toHaveURL(/\/en$/);
  await page.goto("/en/orders?phone=01001234821");

  await page.getByTestId("feedback-open").click();
  const dialog = page.getByRole("dialog", { name: "Send feedback to the Mizan team" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("We'll include the page you're on: /en/orders"); // no query string
  await expect(dialog).not.toContainText("phone=");
  await dialog.getByRole("radio", { name: "Problem" }).click();
  await expect(dialog.getByTestId("feedback-send")).toBeDisabled();
  await dialog.getByLabel("Your message").fill("The export button does nothing");
  await expect(dialog).toContainText("1,970 characters left");
  await dialog.getByTestId("feedback-send").click();
  await expect(page.getByText("Feedback sent. Thank you!")).toBeVisible();
  await expect(dialog).toBeHidden();
});
