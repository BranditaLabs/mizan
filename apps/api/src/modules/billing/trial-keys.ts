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

const GMAIL = new Set(["gmail.com", "googlemail.com"]);

/**
 * The mailbox an address lands in, so aliases share one trial key: lower-cased, a "+tag" dropped
 * from the local part (every domain), and for Gmail the dots too, googlemail.com read as gmail.com.
 * "O.wner+shop2@GoogleMail.com" → "owner@gmail.com".
 */
export function canonicalEmail(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at <= 0) return e;
  let local = e.slice(0, at).replace(/\+.*$/, "");
  let domain = e.slice(at + 1);
  if (GMAIL.has(domain)) {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return `${local || e.slice(0, at)}@${domain}`;
}

export function trialKeys(pepper: SecretValue, who: TrialIdentity): string[] {
  const keys: string[] = [];
  if (who.userId) keys.push(trialKey(pepper, "user", who.userId));
  if (who.email) keys.push(trialKey(pepper, "user", `email:${canonicalEmail(who.email)}`));
  if (who.phone) keys.push(trialKey(pepper, "phone", who.phone.replace(/\s+/g, "")));
  if (who.shopDomain) keys.push(trialKey(pepper, "shop_domain", normalizeDomain(who.shopDomain)));
  return keys;
}
