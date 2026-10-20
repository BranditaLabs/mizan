"use client";

import type { User } from "firebase/auth";

/** The API origin (CORS allows the web app's origin). */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

/** An RFC 9457 problem from the API: `code` is stable, `title` is already in the caller's language. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly title: string, readonly detail?: string) {
    super(`${status} ${code}`);
    this.name = "ApiError";
  }
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Store the request is for (X-Tenant-Id); omit for /me, /tenants and invitations. */
  tenantId?: string | null;
  locale: string;
  /** Safe retries of creates (docs/05 Idempotency-Key). */
  idempotencyKey?: string;
}

/** Call the API as the signed-in user with a fresh ID token (Firebase refreshes it before expiry). */
export async function api<T>(user: User, path: string, o: ApiOptions): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await user.getIdToken()}`,
    "Accept-Language": o.locale,
    Accept: "application/json",
  };
  if (o.tenantId) headers["X-Tenant-Id"] = o.tenantId;
  if (o.body !== undefined) headers["Content-Type"] = "application/json";
  if (o.idempotencyKey) headers["Idempotency-Key"] = o.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1${path}`, { method: o.method ?? "GET", headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  } catch {
    throw new ApiError(0, "network", "");
  }
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
  const p = (await res.json().catch(() => ({}))) as { code?: string; title?: string; detail?: string };
  throw new ApiError(res.status, p.code ?? "unknown", p.title ?? "", p.detail);
}

/** Shapes from apps/api (GET /v1/me, GET /v1/tenant). */
export interface Membership {
  tenantId: string; tenantName: string; tenantSlug: string; tenantStatus: string;
  country: string; baseCurrency: string; locale: string; timezone: string;
  role: "owner" | "admin" | "ops_manager" | "agent" | "warehouse" | "finance" | "viewer";
  status: "active" | "invited" | "disabled";
}
export interface MyInvitation { id: string; tenantId: string; tenantName: string; role: Membership["role"]; expiresAt: string }
export interface Me {
  user: { id: string; email: string | null; phone: string | null; displayName: string | null; language: "ar" | "en"; emailVerified: boolean; mfa: boolean };
  memberships: Membership[];
  invitations: MyInvitation[];
}
