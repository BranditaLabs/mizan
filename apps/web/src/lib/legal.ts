import { LEGAL_DOCUMENTS, type LegalDocument } from "@mizan/shared";
import { ApiError } from "@/lib/api/client";

/**
 * The legal pages (L1-3): /{locale}/legal/{terms,privacy,dpa}. Their text is a copy of docs/legal
 * (the source of truth) in content/legal/, named as there; test/legal-content.test.ts keeps them equal.
 */
export const LEGAL_FILES: Readonly<Record<LegalDocument, string>> = { terms: "terms", privacy: "privacy-policy", dpa: "dpa" };

export const legalPath = (doc: LegalDocument) => `/legal/${doc}` as const;

export function isLegalDocument(value: string): value is LegalDocument {
  return (LEGAL_DOCUMENTS as readonly string[]).includes(value);
}

/** The store's GET /v1/tenant/legal, per signed-in person and store. */
export const legalQueryKey = (uid: string, tenantId: string) => ["legal", uid, tenantId] as const;

/** The documents changed while the page was open (409 legal_version_changed): ask to reload, not "try again". */
export function isLegalVersionChanged(error: unknown): boolean {
  return error instanceof ApiError && error.code === "legal_version_changed";
}

/** What the store's legal check needs: GET /v1/tenant/legal's answer and the query's state. */
export type LegalCheck = { needsAcceptance?: boolean; pending: boolean; error: boolean };

/**
 * What the signed-in (app) layout shows (L1-3). The owner of a store that has not accepted the
 * documents in force gets the full-page "Accept and continue"; while that is still being checked
 * and the documents can be in force (`published`), a loader, so the store never flashes open
 * first. If the check fails, the store opens (the API holds the record, not this screen). Everyone
 * else always gets the store.
 */
export function legalView(role: string | undefined, check: LegalCheck, published: boolean): "store" | "gate" | "loading" {
  if (role !== "owner") return "store";
  if (check.needsAcceptance) return "gate";
  if (check.pending && !check.error && published) return "loading";
  return "store";
}

/** The team's one-line banner while the owner's acceptance is missing (never for the owner). */
export function showLegalBanner(role: string | undefined, check: LegalCheck): boolean {
  return Boolean(role) && role !== "owner" && Boolean(check.needsAcceptance);
}
