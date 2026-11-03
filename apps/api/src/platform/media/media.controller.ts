import { Controller, Get, Inject, Param, Res } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";
import { Public } from "../auth/decorators.js";
import { ProblemError } from "../http/problem.js";
import { MediaService } from "./media.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FILE = /^[0-9a-f-]{36}(_400)?\.webp$/;

/**
 * Product pictures uploaded to Mizan (P3), served to anyone (no /v1, no sign-in): the web app,
 * and the stores that fetch them when a product is published. Each file never changes once
 * written, so it is cached for a year; any site may show it.
 */
@ApiExcludeController()
@Public()
@Controller("media")
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  @Get(":tenant/p/:product/:file")
  async picture(@Param("tenant") tenant: string, @Param("product") product: string, @Param("file") file: string, @Res() reply: FastifyReply) {
    if (!UUID.test(tenant) || !UUID.test(product) || !FILE.test(file)) throw new ProblemError(404, "not_found", "no such picture");
    const found = await this.media.read(tenant, `p/${product}/${file}`);
    if (!found) throw new ProblemError(404, "not_found", "no such picture");
    void reply
      .header("Content-Type", found.contentType)
      .header("Cache-Control", "public, max-age=31536000, immutable")
      .header("Cross-Origin-Resource-Policy", "cross-origin")
      .header("X-Content-Type-Options", "nosniff")
      .send(found.bytes);
  }
}
