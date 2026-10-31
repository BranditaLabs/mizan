import type { Transaction } from "kysely";
import type { DB } from "@mizan/db";
import { ACCEPTED_DOCUMENTS, isCurrentLegal, LEGAL_VERSIONS } from "@mizan/shared";
import { ProblemError } from "../../platform/http/problem.js";

/** 409 unless the versions the person read are the current ones (the page was open across a release). */
export function assertCurrentLegal(versions: { terms: string; dpa: string }): void {
  if (!isCurrentLegal(versions)) {
    throw new ProblemError(409, "legal_version_changed", `the documents changed: current versions are terms ${LEGAL_VERSIONS.terms}, dpa ${LEGAL_VERSIONS.dpa}`);
  }
}

/**
 * Record the store's acceptance of the current terms and DPA, inside the caller's transaction
 * (store creation records it with the store). Accepting a version twice keeps the first record.
 * Returns how many documents were newly accepted (0 when everything was already on record).
 */
export async function recordAcceptance(trx: Transaction<DB>, tenantId: string, userId: string, language: "ar" | "en" | null): Promise<number> {
  const rows = await trx.insertInto("legal_acceptances")
    .values(ACCEPTED_DOCUMENTS.map((document) => ({ tenant_id: tenantId, document, version: LEGAL_VERSIONS[document], accepted_by: userId, language })))
    .onConflict((oc) => oc.columns(["tenant_id", "document", "version"]).doNothing())
    .returning("id")
    .execute();
  return rows.length;
}
