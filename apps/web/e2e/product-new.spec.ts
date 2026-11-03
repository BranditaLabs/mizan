import { deflateSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { ownerWithStore, signInOwner } from "./stack";

/** A plain 300 × 300 PNG, built here (no image library in the web app). */
function png(size = 300): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 0x80)]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(Array(size).fill(row)))), chunk("IEND", Buffer.alloc(0))]);
}

/** P3: a product made in Mizan — options make its variants, a picture uploaded becomes its main one. */
test("owner in English makes a product with sizes, uploads its picture, and sees how to publish it", async ({ page }) => {
  const owner = await ownerWithStore("Products New Store");
  await page.goto("/en/sign-in");
  await signInOwner(page, owner, "en");
  await expect(page).toHaveURL(/\/en$/);

  await page.goto("/en/products");
  await page.getByRole("main").getByRole("link", { name: "New product" }).click();
  await expect(page).toHaveURL(/\/en\/products\/new$/);
  const main = page.getByRole("main");
  await main.getByLabel("Name", { exact: true }).fill("Linen Kaftan");
  await main.getByRole("button", { name: "Add an option" }).click();
  await main.getByLabel("Option", { exact: true }).fill("Size");
  await main.getByLabel("Values", { exact: true }).fill("S, M");
  await main.getByLabel("SKU prefix").fill("kaf");
  await main.getByLabel("Price", { exact: true }).first().fill("900");

  const variants = main.getByTestId("new-variants");
  await expect(variants.getByRole("listitem")).toHaveCount(2);
  await expect(variants.getByLabel("SKU", { exact: true }).nth(0)).toHaveValue("KAF-S");
  await expect(variants.getByLabel("SKU", { exact: true }).nth(1)).toHaveValue("KAF-M");
  await variants.getByLabel("Price", { exact: true }).nth(1).fill("950");
  await main.getByRole("button", { name: "Create product" }).click();

  await expect(page).toHaveURL(/\/en\/products\/[0-9a-f-]{36}$/);
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Linen Kaftan");
  await expect(main.getByRole("row", { name: /KAF-M/ })).toContainText("950");

  await main.getByTestId("picture-input").setInputFiles({ name: "kaftan.png", mimeType: "image/png", buffer: png() });
  const pictures = main.getByTestId("pictures-card");
  await expect(pictures.getByText("Main", { exact: true })).toBeVisible();
  await expect(pictures.locator("img")).toHaveAttribute("src", /\/media\/[0-9a-f-]{36}\/p\/[0-9a-f-]{36}\/[0-9a-f-]{36}_400\.webp$/);

  await expect(main.getByTestId("publish-card")).toContainText("Connect a Shopify or WooCommerce store first");
});
