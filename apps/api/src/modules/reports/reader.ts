import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { AuthContext, AuthedRequest } from "../../platform/auth/auth.types.js";
import { localeFrom } from "../../platform/i18n/messages.js";

/**
 * The caller's AuthContext as a reader: names and definitions in the language of the request (the
 * dashboard sends its own), the profile's language when a caller sends none. A parameter
 * decorator rather than @Headers, so the shared optional Accept-Language stays as documented.
 */
export const Reader = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<AuthedRequest & { headers: Record<string, string | string[] | undefined> }>();
  const auth = req.auth;
  if (!auth) throw new Error("@Reader() used on a route that AuthGuard did not authenticate");
  const header = req.headers["accept-language"];
  const lang = Array.isArray(header) ? header[0] : header;
  return lang ? { ...auth, user: { ...auth.user, language: localeFrom(lang) } } : auth;
});
