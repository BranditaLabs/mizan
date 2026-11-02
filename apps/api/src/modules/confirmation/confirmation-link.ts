import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

/**
 * The customer's confirm link token (E6-7): the run id and a MAC, short enough for an SMS
 * (38 characters). Nothing secret is stored: the token is rebuilt from the run id whenever a
 * message is sent, and the run row decides whether the link still works (expiry, answered).
 *
 *   base64url( run uuid (16 bytes) ‖ HMAC-SHA256(key, uuid)[0..12] )
 */
const MAC_BYTES = 12;
/** Development and tests only (config refuses a missing key in production). */
const DEV_KEY = Buffer.alloc(32, 7).toString("base64");

const keyOf = (secret: string | undefined) => Buffer.from(hkdfSync("sha256", Buffer.from(secret ?? DEV_KEY, "base64"), Buffer.alloc(0), "mizan:confirm-link", 32));

export function linkToken(secret: string | undefined, runId: string): string {
  const id = Buffer.from(runId.replace(/-/g, ""), "hex");
  const mac = createHmac("sha256", keyOf(secret)).update(id).digest().subarray(0, MAC_BYTES);
  return Buffer.concat([id, mac]).toString("base64url");
}

/** The run id, or null for a forged or malformed token. */
export function runIdOf(secret: string | undefined, token: unknown): string | null {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{30,48}$/.test(token)) return null;
  const raw = Buffer.from(token, "base64url");
  if (raw.length !== 16 + MAC_BYTES) return null;
  const id = raw.subarray(0, 16);
  const expected = createHmac("sha256", keyOf(secret)).update(id).digest().subarray(0, MAC_BYTES);
  if (!timingSafeEqual(raw.subarray(16), expected)) return null;
  const hex = id.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * WhatsApp button and list-row ids (E6-10): the customer answers by tapping, and the tap comes
 * back with the id we set. Signed, so a forged or edited id does nothing; bound to the run, so a
 * tap on an old message answers only that order. At most 256 characters (Meta's limit).
 *
 *   c1.<run uuid, base64url>.<action>[.<arg>].<HMAC-SHA256(key, everything before)[0..12], base64url>
 */
export const CHAT_ACTIONS = ["confirm", "change", "cancel", "keep", "reason", "offer_yes", "offer_no"] as const;
export type ChatAction = (typeof CHAT_ACTIONS)[number];

const chatKey = (secret: string | undefined) => Buffer.from(hkdfSync("sha256", Buffer.from(secret ?? DEV_KEY, "base64"), Buffer.alloc(0), "mizan:wa-action", 32));
const ARG = /^[a-z0-9_-]{1,64}$/i;

export function actionId(secret: string | undefined, runId: string, action: ChatAction, arg?: string): string {
  if (arg !== undefined && !ARG.test(arg)) throw new Error("action argument must be a short id");
  const body = ["c1", Buffer.from(runId.replace(/-/g, ""), "hex").toString("base64url"), action, ...(arg !== undefined ? [arg] : [])].join(".");
  return `${body}.${createHmac("sha256", chatKey(secret)).update(body).digest().subarray(0, MAC_BYTES).toString("base64url")}`;
}

/** The run, action and argument behind a tapped id; null when it is not one of ours or was altered. */
export function parseActionId(secret: string | undefined, id: unknown): { runId: string; action: ChatAction; arg?: string } | null {
  if (typeof id !== "string" || id.length > 256) return null;
  const parts = id.split(".");
  if (parts[0] !== "c1" || parts.length < 4 || parts.length > 5) return null;
  const mac = parts.pop()!;
  const body = parts.join(".");
  const expected = createHmac("sha256", chatKey(secret)).update(body).digest().subarray(0, MAC_BYTES);
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const [, run, action, arg] = parts;
  const raw = Buffer.from(run!, "base64url");
  if (raw.length !== 16 || !(CHAT_ACTIONS as readonly string[]).includes(action!)) return null;
  if (arg !== undefined && !ARG.test(arg)) return null;
  const hex = raw.toString("hex");
  const runId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return { runId, action: action as ChatAction, ...(arg !== undefined ? { arg } : {}) };
}
