/**
 * Legal documents (L1-3). The texts live in docs/legal (the source of truth) and are copied into
 * apps/web/content/legal for the public pages at /{locale}/legal/{terms,privacy,dpa}. A store's
 * owner accepts the terms and the DPA, version by version (table legal_acceptances); the privacy
 * policy is a notice, read, not accepted.
 */
export const LEGAL_DOCUMENTS = ["terms", "privacy", "dpa"] as const;
export type LegalDocument = (typeof LEGAL_DOCUMENTS)[number];

/** The documents an owner accepts. Mirrors the CHECK constraint on legal_acceptances.document. */
export const ACCEPTED_DOCUMENTS = ["terms", "dpa"] as const satisfies readonly LegalDocument[];
export type AcceptedDocument = (typeof ACCEPTED_DOCUMENTS)[number];

/** The current version of each document, "major.minor". Bump it when the text changes. */
export const LEGAL_VERSIONS: Readonly<Record<LegalDocument, string>> = { terms: "0.1", privacy: "0.1", dpa: "0.1" };

export type LegalStatus = "draft" | "published";

/**
 * Whether the documents are in force. Going live is one change: set the approved versions in
 * LEGAL_VERSIONS (1.0 or later; drafts are 0.x) AND flip this to "published", once counsel has
 * approved the texts and the owner's placeholders are filled. Bumping the versions matters:
 * acceptances recorded at store creation while the texts were drafts carry 0.x, so they never
 * count as acceptance of the published texts (test/legal.test.ts fails on "published" with a 0.x
 * version). From then on the dashboard asks every store's owner to accept the current terms and
 * DPA before using the store (a UI gate; the API does not refuse requests yet), and the pages
 * lose their draft banner.
 */
export const LEGAL_STATUS: LegalStatus = "draft";

export function isAcceptedDocument(value: string): value is AcceptedDocument {
  return (ACCEPTED_DOCUMENTS as readonly string[]).includes(value);
}

/** True when the given versions are the current ones for every accepted document. */
export function isCurrentLegal(versions: Partial<Record<AcceptedDocument, string>>): boolean {
  return ACCEPTED_DOCUMENTS.every((d) => versions[d] === LEGAL_VERSIONS[d]);
}

/** A store must accept when the documents are in force and a current version is not accepted yet. */
export function needsLegalAcceptance(
  status: LegalStatus,
  accepted: ReadonlyArray<{ document: string; version: string }>,
): boolean {
  if (status !== "published") return false;
  return ACCEPTED_DOCUMENTS.some((d) => !accepted.some((a) => a.document === d && a.version === LEGAL_VERSIONS[d]));
}
