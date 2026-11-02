import { Body, Controller, Get, Header, HttpCode, Inject, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Auth, NoSupport, Public, Roles } from "../../platform/auth/decorators.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import { ApiJson, ApiJsonBody, ApiProblems } from "../../platform/http/api-schema.js";
import { ZodPipe } from "../../platform/http/zod.pipe.js";
import { AcceptLegalSchema, PublicLegalSchema, StoreLegalSchema, type AcceptLegalBody, type PublicLegal, type StoreLegal } from "./legal.dto.js";
import { LegalService } from "./legal.service.js";

/** The current documents and whether they are in force, for the sign-up screen and the legal pages. No sign-in. */
@ApiTags("auth")
@Controller("public/legal")
@Public()
export class PublicLegalController {
  constructor(@Inject(LegalService) private readonly legal: LegalService) {}

  @Get()
  @Header("Cache-Control", "public, max-age=300")
  @ApiJson(200, "PublicLegal", PublicLegalSchema, "The current version of each legal document and whether they are in force")
  current(): PublicLegal {
    return this.legal.current();
  }
}

/** The store's acceptance of the terms of service and the data processing agreement (L1-3). */
@ApiTags("platform")
@Controller("tenant/legal")
export class StoreLegalController {
  constructor(@Inject(LegalService) private readonly legal: LegalService) {}

  /** Any member: the dashboard asks the owner to accept, and tells the team when the owner must. */
  @Get()
  @ApiJson(200, "StoreLegal", StoreLegalSchema, "What the store accepted, and whether the owner must accept the current versions")
  get(@Auth() auth: AuthContext): Promise<StoreLegal> {
    return this.legal.forStore(auth.tenant!.id);
  }

  /** The owner, in person (never support access), accepts the versions they read. */
  @Post("accept")
  @HttpCode(200)
  @Roles("owner")
  @NoSupport()
  @ApiJsonBody("AcceptLegal", AcceptLegalSchema)
  @ApiJson(200, "StoreLegal", StoreLegalSchema, "Accepted; audited (tenant.legal_accepted). Accepting the same versions again changes nothing")
  @ApiProblems(403, 409, 422)
  accept(@Auth() auth: AuthContext, @Body(new ZodPipe(AcceptLegalSchema)) body: AcceptLegalBody): Promise<StoreLegal> {
    return this.legal.accept(auth, body);
  }
}
