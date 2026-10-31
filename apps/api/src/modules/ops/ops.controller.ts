import { Body, Controller, HttpCode, Inject, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { OpsSyncResultSchema, OpsSyncSchema } from "./ops.dto.js";
import { OpsSyncService } from "./ops-sync.service.js";

/** The ops app (Flutter, offline-first): operations queued on the phone, applied once each. */
@ApiTags("ops")
@Controller("ops")
@Roles("owner", "admin", "ops_manager", "warehouse")
export class OpsController {
  constructor(@Inject(OpsSyncService) private readonly ops: OpsSyncService) {}

  @Post("sync")
  @HttpCode(200)
  @ApiJsonBody("OpsSync", OpsSyncSchema)
  @ApiJson(200, "OpsSyncResult", OpsSyncResultSchema, "One result per op, in the order sent; a replayed opId returns its first outcome")
  @ApiProblems(422)
  sync(@Auth() auth: AuthContext, @Body(new ZodPipe(OpsSyncSchema)) body: z.infer<typeof OpsSyncSchema>) {
    return this.ops.sync(auth, body);
  }
}
