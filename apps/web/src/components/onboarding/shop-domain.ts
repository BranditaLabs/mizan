/** "nile-abayas" or "https://nile-abayas.myshopify.com/admin" → "nile-abayas.myshopify.com"; null if it can't be one. */
export function shopDomain(input: string): string | null {
  const host = input.trim().toLowerCase().replace(/^https?:\/\//, "").split(/[/?#]/)[0] ?? "";
  const full = host.endsWith(".myshopify.com") ? host : host.includes(".") ? null : `${host}.myshopify.com`;
  return full && /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(full) ? full : null;
}
