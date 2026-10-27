import type { FastifyReply, FastifyRequest } from "fastify";

/** The HTTP request and reply as guards, interceptors, filters and @Req/@Res see them (Fastify, H-12). */
export type HttpRequest = FastifyRequest;
export type HttpReply = FastifyReply;

/** The matched route template ("/v1/members/:userId"), never ids or query strings; "unmatched" for a 404. */
export const routeTemplate = (req: FastifyRequest): string => req.routeOptions?.url ?? "unmatched";

/** The request id pino-http gave this request (also sent back as X-Request-Id). */
export const requestIdOf = (req: FastifyRequest): string | undefined => {
  const id = (req.raw as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
};
