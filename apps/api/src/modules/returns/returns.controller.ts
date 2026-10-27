import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Auth, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { InspectSchema, ReturnStateSchema, type InspectBody } from "./returns.dto.js";
import { ReturnsService } from "./returns.service.js";

/** M6 return inspection on an order (E10-3). */
@ApiTags("returns")
@Controller("orders/:id/returns")
export class ReturnsController {
  constructor(@Inject(ReturnsService) private readonly returns: ReturnsService) {}

  @Get()
  @Roles("owner", "admin", "ops_manager", "finance", "warehouse")
  @ApiJson(200, "ReturnState", ReturnStateSchema, "Each line: how many units came back sellable, damaged or written off, and how many are left")
  @ApiProblems(404)
  state(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string) {
    return this.returns.state(auth, id);
  }

  @Post("inspect")
  @HttpCode(200)
  @Roles("owner", "admin", "ops_manager", "warehouse")
  @ApiJsonBody("Inspect", InspectSchema)
  @ApiJson(200, "ReturnState", ReturnStateSchema, "Recorded: restocked units go back into stock, lost units count on the order's profit; audited")
  @ApiProblems(404, 409, 422)
  inspect(@Auth() auth: AuthContext, @Param("id", new ParseUUIDPipe()) id: string, @Body(new ZodPipe(InspectSchema)) body: InspectBody) {
    return this.returns.inspect(auth, id, body);
  }
}
