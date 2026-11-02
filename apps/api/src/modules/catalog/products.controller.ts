import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { CatalogVariantSchema, CostsImportedSchema, ImportCostsSchema, ProductPageSchema, ProductQuerySchema, UpdateVariantSchema } from "./catalog.dto.js";
import { ProductsService } from "./products.service.js";

/** The catalogue screen (M4, E8-1): products from the store, with the cost and barcode Mizan adds. */
@ApiTags("catalog")
@Controller("products")
@Roles("owner", "admin", "ops_manager", "finance")
export class ProductsController {
  constructor(@Inject(ProductsService) private readonly products: ProductsService) {}

  @Get()
  @ApiQueryZod(ProductQuerySchema)
  @ApiJson(200, "ProductPage", ProductPageSchema, "Products by title, each with its variants")
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(ProductQuerySchema)) q: z.output<typeof ProductQuerySchema>) {
    return this.products.list(auth.tenant!.id, q);
  }

  @Patch("variants/:id")
  @ApiJsonBody("UpdateVariant", UpdateVariantSchema)
  @ApiJson(200, "CatalogVariant", CatalogVariantSchema, "Saved; title, price and SKU are the store's and change there")
  @ApiProblems(404, 409)
  update(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(UpdateVariantSchema)) body: z.infer<typeof UpdateVariantSchema>) {
    return this.products.updateVariant(auth, id, body);
  }

  @Post("costs/import")
  @HttpCode(200)
  @ApiJsonBody("ImportCosts", ImportCostsSchema)
  @ApiJson(200, "CostsImported", CostsImportedSchema, "Every row applied; any bad line: 422 csv_invalid naming each line, nothing saved")
  @ApiProblems(422)
  import(@Auth() auth: AuthContext, @Body(new ZodPipe(ImportCostsSchema)) body: z.infer<typeof ImportCostsSchema>) {
    return this.products.importCosts(auth, body.csv);
  }
}
