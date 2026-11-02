import type { Page } from "@playwright/test";
import { API, EMULATOR, PROJECT } from "./env.mjs";

/** Helpers on the Firebase Auth emulator and the real API (same approach as apps/web/e2e/stack.ts). */
const ID = `${EMULATOR}/identitytoolkit.googleapis.com`;
const EMU = `${EMULATOR}/emulator/v1/projects/${PROJECT}`;
export const PASSWORD = "correct-horse-42";

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(`${url}?key=demo-key`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json()) as T & { error?: { message: string } };
  if (!res.ok) throw new Error(`${url}: ${res.status} ${json.error?.message ?? ""}`);
  return json;
}

const rand = (digits: number) => String(Math.floor(Math.random() * 10 ** digits)).padStart(digits, "0");
export const newPhone = () => `+2010${rand(8)}`;
export const newEmail = (who: string) => `${who}-${Date.now()}-${rand(6)}@example.com`;

async function codes(match: { phone?: string; sessionInfo?: string }) {
  const { verificationCodes = [] } = (await (await fetch(`${EMU}/verificationCodes`)).json()) as { verificationCodes?: Array<{ phoneNumber: string; sessionInfo: string; code: string }> };
  return verificationCodes.filter((c) => (match.phone ? c.phoneNumber === match.phone : c.sessionInfo === match.sessionInfo));
}

export async function smsCode(match: { phone?: string; sessionInfo?: string }, seen = 0): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const found = await codes(match);
    if (found.length > seen) return found.at(-1)!.code;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no SMS code for ${JSON.stringify(match)}`);
}

/** Email + password, email confirmed, SMS second factor enrolled, signed in with both: an ID token with a second factor. */
export async function personWithTwoStep(email: string, phone: string): Promise<string> {
  const { idToken } = await post<{ idToken: string }>(`${ID}/v1/accounts:signUp`, { email, password: PASSWORD, returnSecureToken: true });
  await post(`${ID}/v1/accounts:sendOobCode`, { requestType: "VERIFY_EMAIL", idToken });
  const { oobCodes = [] } = (await (await fetch(`${EMU}/oobCodes`)).json()) as { oobCodes?: Array<{ email: string; requestType: string; oobCode: string }> };
  await post(`${ID}/v1/accounts:update`, { oobCode: oobCodes.filter((c) => c.email === email && c.requestType === "VERIFY_EMAIL").at(-1)!.oobCode });
  const fresh = await post<{ idToken: string }>(`${ID}/v1/accounts:signInWithPassword`, { email, password: PASSWORD, returnSecureToken: true });
  const start = await post<{ phoneSessionInfo: { sessionInfo: string } }>(`${ID}/v2/accounts/mfaEnrollment:start`, { idToken: fresh.idToken, phoneEnrollmentInfo: { phoneNumber: phone } });
  const sessionInfo = start.phoneSessionInfo.sessionInfo;
  await post(`${ID}/v2/accounts/mfaEnrollment:finalize`, { idToken: fresh.idToken, phoneVerificationInfo: { sessionInfo, code: await smsCode({ sessionInfo }) } });
  const first = await post<{ mfaPendingCredential: string; mfaInfo: Array<{ mfaEnrollmentId: string }> }>(`${ID}/v1/accounts:signInWithPassword`, { email, password: PASSWORD, returnSecureToken: true });
  const challenge = await post<{ phoneResponseInfo: { sessionInfo: string } }>(`${ID}/v2/accounts/mfaSignIn:start`,
    { mfaPendingCredential: first.mfaPendingCredential, mfaEnrollmentId: first.mfaInfo[0]!.mfaEnrollmentId, phoneSignInInfo: {} });
  const s = challenge.phoneResponseInfo.sessionInfo;
  const done = await post<{ idToken: string }>(`${ID}/v2/accounts/mfaSignIn:finalize`,
    { mfaPendingCredential: first.mfaPendingCredential, phoneVerificationInfo: { sessionInfo: s, code: await smsCode({ sessionInfo: s }) } });
  return done.idToken;
}

export async function mizan<T>(token: string, method: string, path: string, body?: unknown, tenantId?: string): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (tenantId) headers["X-Tenant-Id"] = tenantId;
  if (method === "POST") headers["Idempotency-Key"] = crypto.randomUUID();
  const res = await fetch(`${API}/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (res.status === 204 ? undefined : await res.json()) as T };
}

/** Sign in through the back office's UI: email, password, then the texted code. */
export async function signIn(page: Page, person: { email: string; phone: string }) {
  await page.goto("/en/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(person.email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  const seen = (await codes({ phone: person.phone })).length;
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Code", { exact: true }).fill(await smsCode({ phone: person.phone }, seen));
  await page.getByRole("button", { name: "Verify", exact: true }).click();
}
