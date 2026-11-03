import { sql, type Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { z } from "zod";

/** A product picture as order lines, pick lists and pickers show it (O1). */
export const LinePictureSchema = z.object({ url: z.url(), alt: z.string().nullable() })
  .nullable().describe("The variant's picture, else its product's main picture; null when the product has none or is not in the catalogue");
export type LinePicture = z.infer<typeof LinePictureSchema>;

/**
 * The picture to show for each variant (O1): its own picture when the store set one (a colour's),
 * else its product's main picture, in one query. Variants without either are left out.
 */
export async function variantPictures(trx: Transaction<DB>, variantIds: ReadonlyArray<string | null>): Promise<Map<string, NonNullable<LinePicture>>> {
  const ids = [...new Set(variantIds.filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map();
  const rows = await trx.selectFrom("variants as v")
    .leftJoin("product_images as own", "own.id", "v.image_id")
    .leftJoin("product_images as main", (j) => j.onRef("main.product_id", "=", "v.product_id").on("main.is_main", "=", true))
    .select(["v.id", sql<string | null>`coalesce(own.url, main.url)`.as("url"), sql<string | null>`coalesce(own.alt, main.alt)`.as("alt")])
    .where("v.id", "in", ids).execute();
  return new Map(rows.flatMap((r) => (r.url ? [[r.id, { url: r.url, alt: r.alt }] as const] : [])));
}
