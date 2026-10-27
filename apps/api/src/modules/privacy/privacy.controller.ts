import { Controller, Get, Inject, Param, ParseUUIDPipe } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { ApiJson, ApiProblems } from "../../platform/http/api-schema.js";
import { Auth, NoSupport, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { PrivacyService } from "./privacy.service.js";

const PrivacyRequestsSchema = z.object({
  data: z.array(z.object({
    id: z.uuid(), source: z.string(), status: z.string(), dueAt: z.iso.datetime(), completedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(), hasExport: z.boolean(),
  })),
});
const PrivacyExportSchema = z.unknown().describe("The customer's data compiled for a data request (JSON)");

/** Privacy requests received for this store (Shopify compliance webhooks today). */
@ApiTags("privacy")
@Controller("privacy-requests")
@Roles("owner", "admin")
export class PrivacyController {
  constructor(@Inject(PrivacyService) private readonly privacy: PrivacyService) {}

  @Get()
  @ApiJson(200, "PrivacyRequests", PrivacyRequestsSchema, "Newest first, at most 200")
  list(@Auth() auth: AuthContext) {
    return this.privacy.list(auth);
  }

  @Get(":id/export")
  @NoSupport()
  @ApiJson(200, "PrivacyExport", PrivacyExportSchema, "Every download is in the audit log")
  @ApiProblems(404, 409)
  export(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.privacy.export(auth, id);
  }
}
