import { Body, Controller, HttpCode, Inject, Post, Req, Res } from "@nestjs/common";
import { ApiExcludeController, ApiTags } from "@nestjs/swagger";
import type { HttpReply as Response, HttpRequest as Request } from "../../../platform/http/http.types.js";
import type { z } from "zod";
import { Auth, Public, Roles } from "../../../platform/auth/decorators.js";
import type { AuthContext } from "../../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems } from "../../../platform/http/api-schema.js";
import { ZodPipe } from "../../../platform/http/zod.pipe.js";
import { ConnectionViewSchema, WooCommerceAuthorizeSchema, WooCommerceAuthorizeUrlSchema, WooCommerceKeysSchema } from "../connections.dto.js";
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

  /** E5-7 one click: WooCommerce's approval page for the store; the keys come back to Mizan by themselves. */
  @Post("authorize")
  @HttpCode(200)
  @Roles("owner", "admin")
  @ApiJsonBody("WooCommerceAuthorize", WooCommerceAuthorizeSchema)
  @ApiJson(200, "WooCommerceAuthorizeUrl", WooCommerceAuthorizeUrlSchema, "Open it in the browser: the owner approves Read/Write in WooCommerce and comes back to Settings → Integrations")
  @ApiProblems(422)
  authorize(@Auth() auth: AuthContext, @Body(new ZodPipe(WooCommerceAuthorizeSchema)) body: z.infer<typeof WooCommerceAuthorizeSchema>) {
    return this.woo.authorizeUrl(auth, body.siteUrl, body.locale);
  }
}

/**
 * E5-7 one click: WooCommerce posts the keys the owner approved here (server to server, no
 * session: the signed `user_id` says which store asked). 200 only once they are saved.
 */
@ApiExcludeController()
@Public()
@Controller("webhooks")
export class WooCommerceAuthCallbackController {
  constructor(@Inject(WooCommerceConnectService) private readonly woo: WooCommerceConnectService) {}

  @Post("woocommerce-auth")
  @HttpCode(200)
  async keys(@Req() req: Request, @Res() res: Response) {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : typeof req.body === "string" ? req.body : "";
    const result = await this.woo.receiveKeys(raw);
    return res.code(result.status).send(result.body);
  }
}
