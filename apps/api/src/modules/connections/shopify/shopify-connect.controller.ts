import { Body, Controller, Get, Inject, Post, Query, Res } from "@nestjs/common";
import { ApiExcludeEndpoint, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { z } from "zod";
import { Auth, Public, Roles } from "../../../platform/auth/decorators.js";
import type { AuthContext } from "../../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems } from "../../../platform/http/api-schema.js";
import { ZodPipe } from "../../../platform/http/zod.pipe.js";
import { ShopifyInstallService } from "./shopify-install.service.js";

const ClaimSchema = z.strictObject({ install: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "must be the install token from the redirect") });

const InstallStartSchema = z.object({ authorizeUrl: z.url().describe("Send the browser here (Shopify's consent screen)") });
const ClaimResultSchema = z.object({
  connection: z.object({ id: z.uuid(), provider: z.literal("shopify"), account: z.string(), status: z.literal("active"), scopes: z.array(z.string()) }),
  reconnected: z.boolean(),
});

/** No referrer on our redirects: callback and claim URLs carry one-time values. */
const redirect = (res: Response, url: string) => res.setHeader("Referrer-Policy", "no-referrer").redirect(302, url);

/** Shopify app install (E3-1). See ShopifyInstallService for the flow and why it has a claim step. */
@ApiTags("connections")
@Controller("connections/shopify")
export class ShopifyConnectController {
  constructor(@Inject(ShopifyInstallService) private readonly installs: ShopifyInstallService) {}

  /** Start connecting a store from inside Mizan: returns Shopify's authorize URL for the browser. */
  @Get("install")
  @Roles("owner", "admin")
  @ApiQuery({ name: "shop", required: true, description: "The store's myshopify.com domain", schema: { type: "string" } })
  @ApiJson(200, "ShopifyInstallStart", InstallStartSchema, "Shopify's authorize URL")
  @ApiProblems(422)
  install(@Auth() auth: AuthContext, @Query("shop") shop: string) {
    return this.installs.begin(auth, shop);
  }

  /** App URL in the Shopify Partner Dashboard: install from the App Store or open from Shopify admin. */
  @Public()
  @Get("entry")
  @ApiExcludeEndpoint()
  entry(@Query() query: Record<string, unknown>, @Res() res: Response) {
    redirect(res, this.installs.entry(query));
  }

  /** Allowed redirection URL in the Partner Dashboard. */
  @Public()
  @Get("callback")
  @ApiExcludeEndpoint()
  async callback(@Query() query: Record<string, unknown>, @Res() res: Response) {
    redirect(res, await this.installs.callback(query));
  }

  /** Attach the approved install to the current store. */
  @Post("claim")
  @Roles("owner", "admin")
  @ApiJsonBody("ShopifyClaim", ClaimSchema)
  @ApiJson(201, "ShopifyClaimResult", ClaimResultSchema, "The store is connected (or reconnected)")
  @ApiProblems(404, 409)
  claim(@Auth() auth: AuthContext, @Body(new ZodPipe(ClaimSchema)) body: z.infer<typeof ClaimSchema>) {
    return this.installs.claim(auth, body.install);
  }
}
