import { Inject, Injectable } from "@nestjs/common";
import { ACCEPTED_DOCUMENTS, LEGAL_DOCUMENTS, LEGAL_VERSIONS, needsLegalAcceptance, type LegalStatus } from "@mizan/shared";
import { Database } from "../../platform/db/database.js";
import { AuditService, auditActor } from "../../platform/audit/audit.service.js";
import type { AuthContext } from "../../platform/auth/auth.types.js";
import type { AcceptLegalBody, PublicLegal, StoreLegal } from "./legal.dto.js";
import { assertCurrentLegal, recordAcceptance } from "./legal.store.js";

/** Whether the legal documents are in force; @mizan/shared LEGAL_STATUS unless a test replaces it. */
export const LEGAL_STATUS_TOKEN = Symbol("LEGAL_STATUS");

/** Terms of service and DPA acceptance per store (L1-3). */
@Injectable()
export class LegalService {
  constructor(
    @Inject(Database) private readonly db: Database,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(LEGAL_STATUS_TOKEN) private readonly status: LegalStatus,
  ) {}

  current(): PublicLegal {
    return { status: this.status, documents: LEGAL_DOCUMENTS.map((key) => ({ key, version: LEGAL_VERSIONS[key] })) };
  }

  async forStore(tenantId: string): Promise<StoreLegal> {
    const rows = await this.db.tenant(tenantId, (trx) => trx.selectFrom("legal_acceptances as a").leftJoin("users as u", "u.id", "a.accepted_by")
      .select(["a.document", "a.version", "a.accepted_at", "a.accepted_by", "u.display_name"]).execute());
    return {
      status: this.status,
      documents: ACCEPTED_DOCUMENTS.map((document) => {
        const row = rows.find((r) => r.document === document && r.version === LEGAL_VERSIONS[document]);
        return {
          document, version: LEGAL_VERSIONS[document],
          acceptedAt: row ? row.accepted_at.toISOString() : null,
          acceptedBy: row?.accepted_by ? { name: row.display_name } : null,
        };
      }),
      needsAcceptance: needsLegalAcceptance(this.status, rows),
    };
  }

  /** The owner accepts the current terms and DPA; audited (tenant.legal_accepted) when something new was recorded. */
  async accept(auth: AuthContext, body: AcceptLegalBody): Promise<StoreLegal> {
    assertCurrentLegal(body);
    const tenantId = auth.tenant!.id;
    await this.db.tenant(tenantId, async (trx) => {
      if (await recordAcceptance(trx, tenantId, auth.user.id, body.language ?? null) === 0) return;
      await this.audit.record(trx, {
        action: "tenant.legal_accepted", tenantId, ...auditActor(auth), entity: { type: "tenant", id: tenantId },
        after: { terms: body.terms, dpa: body.dpa, language: body.language ?? null },
      });
    });
    return this.forStore(tenantId);
  }
}
