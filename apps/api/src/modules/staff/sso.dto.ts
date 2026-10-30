import { z } from "zod";

const Domain = z.string().trim().toLowerCase().max(253).regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/, "a domain such as acme.com");
const ProviderId = z.string().regex(/^(saml|oidc)\.[a-z0-9-]{1,60}$/, "a Firebase Identity Platform provider id such as saml.acme");

export const SsoLookupSchema = z.strictObject({ email: z.email().max(254).describe("The work email typed on the sign-in screen") });
export const SsoProviderSchema = z.object({ providerId: ProviderId.describe("Sign in with this provider (SAMLAuthProvider or OAuthProvider in the Firebase SDK)") });

export const SsoDomainSchema = z.object({ domain: Domain, providerId: ProviderId, enabled: z.boolean(), updatedAt: z.iso.datetime() });
export const SsoDomainsSchema = z.object({ data: z.array(SsoDomainSchema) });
export const SsoDomainParamSchema = Domain;
export const SetSsoDomainSchema = z.strictObject({
  providerId: ProviderId.describe("Created first in Firebase Identity Platform with the company's SAML or OIDC settings"),
  enabled: z.boolean().default(true),
  reason: z.string().trim().min(3).max(500).describe("How the domain was verified with the store; shown in its audit log"),
});
export const RemoveSsoDomainSchema = z.strictObject({ reason: z.string().trim().min(3).max(500).optional() });
