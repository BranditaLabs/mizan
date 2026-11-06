import { createHmac } from "node:crypto";
import type { SecretValue } from "../../platform/secrets/secret-value.js";

/** What identifies a trial taker (docs/16 §7.2 one_trial_per): the owner (account and verified email), their phone, the shop domain. */
export interface TrialIdentity { userId?: string; email?: string | null; phone?: string | null; shopDomain?: string | null }

export type TrialKeyKind = "user" | "phone" | "shop_domain";

/** '<kind>:' + HMAC-SHA256(platform pepper, normalised value). Never a plain hash: an Egyptian mobile space (~10⁹) is reversible. */
export function trialKey(pepper: SecretValue, kind: TrialKeyKind, value: string): string {
  const mac = createHmac("sha256", Buffer.from(pepper.reveal(), "base64")).update(`${kind}:${value}`).digest("hex");
  return `${kind}:${mac}`;
}

/** "https://Nile-Abayas.myshopify.com/" → "nile-abayas.myshopify.com". */
export const normalizeDomain = (d: string) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");

export function trialKeys(pepper: SecretValue, who: TrialIdentity): string[] {
  const keys: string[] = [];
  if (who.userId) keys.push(trialKey(pepper, "user", who.userId));
  if (who.email) keys.push(trialKey(pepper, "user", `email:${who.email.trim().toLowerCase()}`));
  if (who.phone) keys.push(trialKey(pepper, "phone", who.phone.replace(/\s+/g, "")));
  if (who.shopDomain) keys.push(trialKey(pepper, "shop_domain", normalizeDomain(who.shopDomain)));
  return keys;
}
