import { Controller, Get, Inject, Param, ParseUUIDPipe } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { PrivacyService } from "./privacy.service.js";

/** Privacy requests received for this store (Shopify compliance webhooks today). */
@ApiTags("privacy")
@Controller("privacy-requests")
@Roles("owner", "admin")
export class PrivacyController {
  constructor(@Inject(PrivacyService) private readonly privacy: PrivacyService) {}

  @Get()
  list(@Auth() auth: AuthContext) {
    return this.privacy.list(auth);
  }

  @Get(":id/export")
  export(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.privacy.export(auth, id);
  }
}
