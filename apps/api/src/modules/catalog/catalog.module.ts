import { Global, Module } from "@nestjs/common";
import { CatalogController } from "./catalog.controller.js";
import { CatalogService } from "./catalog.service.js";
import { ProductProjector } from "./product-projector.js";

/** Products and costs (M4). Global: the engine registry projects store products through it. */
@Global()
@Module({ controllers: [CatalogController], providers: [CatalogService, ProductProjector], exports: [ProductProjector] })
export class CatalogModule {}
