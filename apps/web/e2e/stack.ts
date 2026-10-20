import { expect, type Page } from "@playwright/test";
import { API, EMULATOR, PROJECT } from "./env.mjs";

/**
 * Helpers for the end-to-end stack: read SMS codes and email links from the Firebase Auth emulator,
 * create people and stores through its REST API and the real Mizan API, and sign in through the UI.
 * Every test makes its own people (random email and phone), so tests run in parallel safely.
 */
const ID = `${EMULATOR}/identitytoolkit.googleapis.com`;
const EMU = `${EMULATOR}/emulator/v1/projects/${PROJECT}`;

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(`${url}?key=demo-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok) throw new Error(`${url}: ${res.status} ${json.error?.message ?? ""}`);
  return json;
}

const rand = (digits: number) => String(Math.floor(Math.random() * 10 ** digits)).padStart(digits, "0");
/** A fresh Egyptian mobile: national form (what people type) and E.164 (what Firebase stores). */
export function newPhone() {
  const nsn = `10${rand(8)}`;
  return { national: `0${nsn}`, e164: `+20${nsn}` };
}
export const newEmail = (who: string) => `${who}-${Date.now()}-${rand(6)}@example.com`;
export const PASSWORD = "correct-horse-42";

async function codes(match: { phone?: string; sessionInfo?: string }) {
  const { verificationCodes = [] } = (await (await fetch(`${EMU}/verificationCodes`)).json()) as { verificationCodes?: Array<{ phoneNumber: string; sessionInfo: string; code: string }> };
  return verificationCodes.filter((c) => (match.phone ? c.phoneNumber === match.phone : c.sessionInfo === match.sessionInfo));
}

/** How many SMS codes this number has received so far (to wait for the next one). */
export const smsCount = async (phone: string) => (await codes({ phone })).length;

/** The SMS code the emulator "sent" to this number (or for this verification session), after `seen` earlier ones. */
export async function smsCode(match: { phone?: string; sessionInfo?: string }, seen = 0): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const found = await codes(match);
    if (found.length > seen) return found.at(-1)!.code;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no SMS code for ${JSON.stringify(match)}`);
}

/** Open the latest email-verification link sent to this address (as clicking it would). */
export async function confirmEmail(email: string): Promise<void> {
  const { oobCodes = [] } = (await (await fetch(`${EMU}/oobCodes`)).json()) as { oobCodes?: Array<{ email: string; requestType: string; oobCode: string }> };
  const link = oobCodes.filter((c) => c.email === email && c.requestType === "VERIFY_EMAIL").at(-1);
  if (!link) throw new Error(`no verification email for ${email}`);
  await post(`${ID}/v1/accounts:update`, { oobCode: link.oobCode });
}

/** A phone-number account (agents, warehouse), signed in: its ID token. */
export async function phoneUser(e164: string): Promise<string> {
  const { sessionInfo } = await post<{ sessionInfo: string }>(`${ID}/v1/accounts:sendVerificationCode`, { phoneNumber: e164 });
  const { idToken } = await post<{ idToken: string }>(`${ID}/v1/accounts:signInWithPhoneNumber`, { sessionInfo, code: await smsCode({ sessionInfo }) });
  return idToken;
}

/**
 * An owner the way the product makes one: email + password, email confirmed, SMS second factor
 * enrolled, then signed in with both: the ID token carries `firebase.sign_in_second_factor`.
 */
export async function ownerWithTwoStep(email: string, phoneE164: string): Promise<string> {
  const { idToken } = await post<{ idToken: string }>(`${ID}/v1/accounts:signUp`, { email, password: PASSWORD, returnSecureToken: true });
  await post(`${ID}/v1/accounts:sendOobCode`, { requestType: "VERIFY_EMAIL", idToken });
  await confirmEmail(email);
  const fresh = await post<{ idToken: string }>(`${ID}/v1/accounts:signInWithPassword`, { email, password: PASSWORD, returnSecureToken: true });
  const start = await post<{ phoneSessionInfo: { sessionInfo: string } }>(`${ID}/v2/accounts/mfaEnrollment:start`, { idToken: fresh.idToken, phoneEnrollmentInfo: { phoneNumber: phoneE164 } });
  const sessionInfo = start.phoneSessionInfo.sessionInfo;
  await post(`${ID}/v2/accounts/mfaEnrollment:finalize`, { idToken: fresh.idToken, phoneVerificationInfo: { sessionInfo, code: await smsCode({ sessionInfo }) } });

  const first = await post<{ mfaPendingCredential: string; mfaInfo: Array<{ mfaEnrollmentId: string }> }>(`${ID}/v1/accounts:signInWithPassword`, { email, password: PASSWORD, returnSecureToken: true });
  const challenge = await post<{ phoneResponseInfo: { sessionInfo: string } }>(`${ID}/v2/accounts/mfaSignIn:start`,
    { mfaPendingCredential: first.mfaPendingCredential, mfaEnrollmentId: first.mfaInfo[0]!.mfaEnrollmentId, phoneSignInInfo: {} });
  const mfaSession = challenge.phoneResponseInfo.sessionInfo;
  const done = await post<{ idToken: string }>(`${ID}/v2/accounts/mfaSignIn:finalize`,
    { mfaPendingCredential: first.mfaPendingCredential, phoneVerificationInfo: { sessionInfo: mfaSession, code: await smsCode({ sessionInfo: mfaSession }) } });
  return done.idToken;
}

/** Call the Mizan API as someone. */
export async function mizan<T>(token: string, method: string, path: string, body?: unknown, tenantId?: string): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (tenantId) headers["X-Tenant-Id"] = tenantId;
  if (method === "POST") headers["Idempotency-Key"] = crypto.randomUUID();
  const res = await fetch(`${API}/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await res.json()) as T;
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${JSON.stringify(json)}`);
  return json;
}

/** A store with an owner (two-step on), and invitations for the given phones. */
export async function storeWithInvites(name: string, invites: Array<{ phone: string; role: string }>) {
  const owner = await ownerWithTwoStep(newEmail("owner"), newPhone().e164);
  const store = await mizan<{ id: string }>(owner, "POST", "/tenants", { name, country: "EG" });
  for (const i of invites) await mizan(owner, "POST", "/members/invite", { phone: i.phone, role: i.role }, store.id);
  return store.id;
}

/** A phone account that is a member of these stores (invited, then accepted). */
export async function agentIn(phone: { e164: string }, ...storeNames: string[]): Promise<void> {
  const ids = [];
  for (const name of storeNames) ids.push(await storeWithInvites(name, [{ phone: phone.e164, role: "agent" }]));
  const token = await phoneUser(phone.e164);
  const me = await mizan<{ invitations: Array<{ id: string }> }>(token, "GET", "/me");
  for (const inv of me.invitations) await mizan(token, "POST", `/invitations/${inv.id}/accept`);
  expect(me.invitations).toHaveLength(ids.length);
}

/** Sign in through the UI with a phone number and the texted code (Arabic or English labels). */
export async function signInWithPhone(page: Page, phone: { national: string; e164: string }, locale: "ar" | "en" = "ar") {
  const L = locale === "ar" ? { tab: "رقم الموبايل", send: "ابعت الكود", code: "الكود", verify: "تأكيد" } : { tab: "Phone number", send: "Send code", code: "Code", verify: "Verify" };
  await page.getByRole("radio", { name: L.tab, exact: true }).click();
  await page.getByLabel(L.tab, { exact: true }).fill(phone.national);
  const seen = await smsCount(phone.e164);
  await page.getByRole("button", { name: L.send }).click();
  await page.getByLabel(L.code, { exact: true }).fill(await smsCode({ phone: phone.e164 }, seen));
  await page.getByRole("button", { name: L.verify, exact: true }).click();
}
