import { Body, Controller, Inject, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";
import { Auth, Roles } from "../../../platform/auth/decorators.js";
import type { AuthContext } from "../../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems } from "../../../platform/http/api-schema.js";
import { ZodPipe } from "../../../platform/http/zod.pipe.js";
import { ConnectionViewSchema, WooCommerceKeysSchema } from "../connections.dto.js";
import { WooCommerceConnectService } from "./woocommerce-connect.service.js";

@ApiTags("connections")
@Controller("connections/woocommerce")
export class WooCommerceConnectController {
  constructor(@Inject(WooCommerceConnectService) private readonly woo: WooCommerceConnectService) {}

  /** E5-7: connect a WooCommerce store (or give it new keys). Answers `pending`; the keys are checked in the background. */
  @Post()
  @Roles("owner", "admin")
  @ApiJsonBody("WooCommerceKeys", WooCommerceKeysSchema)
  @ApiJson(201, "Connection", ConnectionViewSchema, "Saved; pending until the keys are checked (webhooks pointed at Mizan), then the last 60 days of orders are imported; audited")
  @ApiProblems(409, 422)
  connect(@Auth() auth: AuthContext, @Body(new ZodPipe(WooCommerceKeysSchema)) body: z.infer<typeof WooCommerceKeysSchema>) {
    return this.woo.connect(auth, body);
  }
}
