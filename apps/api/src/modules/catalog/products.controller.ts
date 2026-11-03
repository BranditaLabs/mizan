import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";
import { Auth, Can } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiBody } from "@nestjs/swagger";
import { ApiJson, ApiJsonBody, ApiNoContent, ApiProblems, ApiQueryZod } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import {
  CatalogVariantSchema, CostsImportedSchema, ImportCostsSchema, NewProductSchema, ProductCreatedSchema, ProductDetailSchema, ProductImageSchema, ProductPageSchema, ProductQuerySchema,
  ProductUpdateSchema, PublishProductSchema, PublishStartedSchema, UpdateVariantSchema,
} from "./catalog.dto.js";
import { ProductsService } from "./products.service.js";
import { ProductBuilderService } from "./product-builder.service.js";

/** The catalogue screen (M4, E8-1): products from the store, with the cost and barcode Mizan adds. */
@ApiTags("catalog")
@Controller("products")
@Can("products.read")
export class ProductsController {
  constructor(
    @Inject(ProductsService) private readonly products: ProductsService,
    @Inject(ProductBuilderService) private readonly builder: ProductBuilderService,
  ) {}

  /** P3: a product made in Mizan, with its options and variants (SKUs unique in the store). Audited. */
  @Post()
  @HttpCode(201)
  @Can("products.manage")
  @ApiJsonBody("NewProduct", NewProductSchema)
  @ApiJson(201, "ProductCreated", ProductCreatedSchema, "Created as a draft unless status says otherwise; not in any store until published")
  @ApiProblems(409, 422)
  create(@Auth() auth: AuthContext, @Body(new ZodPipe(NewProductSchema)) body: z.output<typeof NewProductSchema>) {
    return this.builder.create(auth, body);
  }

  /** P3: a picture for a product made in Mizan: the bytes as the body (image/jpeg, image/png or image/webp). */
  @Post(":id/images")
  @HttpCode(201)
  @Can("products.manage")
  @ApiBody({ description: "The picture's bytes (JPEG, PNG or WebP; MEDIA_MAX_BYTES at most)", required: true, schema: { type: "string", format: "binary" } })
  @ApiJson(201, "ProductImage", ProductImageSchema, "Checked, turned upright, re-encoded without metadata; the first is the main picture")
  @ApiProblems(404, 409, 413, 415, 422)
  addPicture(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.builder.addPicture(auth, id, Buffer.isBuffer(body) ? body : undefined);
  }

  @Delete(":id/images/:imageId")
  @HttpCode(204)
  @Can("products.manage")
  @ApiNoContent("Removed with its files; the next picture is the main one if this was")
  @ApiProblems(404, 409)
  async removePicture(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Param("imageId", new ParseUUIDPipe()) imageId: string) {
    await this.builder.removePicture(auth, id, imageId);
  }

  /** P3: put a product made in Mizan on a connected store; it becomes that store's once the store has it. */
  @Post(":id/publish")
  @HttpCode(202)
  @Can("products.manage")
  @ApiJsonBody("PublishProduct", PublishProductSchema)
  @ApiJson(202, "PublishStarted", PublishStartedSchema, "On its way (outbox); GET the product for publish.status")
  @ApiProblems(404, 409, 422)
  publish(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(PublishProductSchema)) body: z.output<typeof PublishProductSchema>) {
    return this.builder.publish(auth, id, body.connectionId);
  }

  @Get()
  @ApiQueryZod(ProductQuerySchema)
  @ApiJson(200, "ProductPage", ProductPageSchema, "Products by title, each with its variants")
  list(@Auth() auth: AuthContext, @Query(new ZodPipe(ProductQuerySchema)) q: z.output<typeof ProductQuerySchema>) {
    return this.products.list(auth.tenant!.id, q);
  }

  @Get(":id")
  @ApiJson(200, "ProductDetail", ProductDetailSchema, "The product in full: pictures (one main), options, variants, details, totals")
  @ApiProblems(404)
  detail(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.products.detail(auth.tenant!.id, id);
  }

  /**
   * P2: edit the product — title, description, status, tags, vendor, type, the pictures' order and
   * the main one, prices. Saved here at once and pushed to its store through the outbox; prices set
   * here are Mizan's from then on (a change in the store is put back). Audited.
   */
  @Patch(":id")
  @Can("products.manage")
  @ApiJsonBody("ProductUpdate", ProductUpdateSchema)
  @ApiJson(200, "ProductDetail", ProductDetailSchema, "The product as saved; the store follows")
  @ApiProblems(404, 422)
  edit(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(ProductUpdateSchema)) body: z.output<typeof ProductUpdateSchema>) {
    return this.products.edit(auth, id, body);
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
