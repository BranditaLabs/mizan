import type { DriftSink } from "../../adapt/drift.js";
import { IntegrationError } from "../../core/errors.js";
import type { PaymentLinkRequest } from "../../core/payment-link.js";
import type { Runtime } from "../../core/runtime.js";
import { PAYMOB_CHECKOUT, PaymobRest, type PaymobCredentials } from "./client.js";
import { intentionBody, mapIntention, type PaymobIntention } from "./mapper.js";

/** The intention path: in Paymob's Postman collection only (the docs page leaves it blank). Confirm on a sandbox account. */
export const INTENTION_PATH = "/v1/intention/";

/**
 * Paymob payment gateway (E14-2a): payment links through the Intention API and the Unified
 * Checkout page, so card data never enters Mizan (rule 13). Creating an intention has no
 * idempotency key, and what a repeated `special_reference` does is unknown: a create is sent once
 * per attempt and never re-sent. A timeout or a 5xx makes the attempt lost — harmless, since its
 * client secret never reached the customer, so nobody can pay it — and the next attempt is a new
 * intention with its own reference. Callbacks and refunds come with E14-2b and E14-2d.
 */
export class PaymobConnector {
  readonly id = "paymob";
  readonly rest: PaymobRest;

  constructor(readonly creds: PaymobCredentials, private readonly rt: Runtime, private readonly drift: DriftSink) {
    this.rest = new PaymobRest(creds, rt);
  }

  health() {
    return { circuit: this.rest.circuit.status, budget: this.rest.bucket.snapshot };
  }

  /** One attempt at an intention for this link. Throws `timeout`/`transient` when the outcome is unknown: the caller makes a new attempt. */
  async createIntention(req: PaymentLinkRequest, attempt: number): Promise<PaymobIntention> {
    const body = intentionBody(req, attempt, this.creds.integrations);
    let raw: unknown;
    try {
      raw = await this.rest.withSecret("createIntention", "POST", INTENTION_PATH, body, false);
    } catch (e) {
      // Unknown outcome on a create: never re-sent with this reference (it may exist, unpaid and unseen).
      if (e instanceof IntegrationError && (e.kind === "timeout" || e.kind === "transient" || e.kind === "circuit_open" || e.kind === "rate_limited")) {
        throw new IntegrationError({ kind: "transient", connector: "paymob", status: e.status, message: `createIntention attempt ${attempt} has no answer: a new attempt will be made`, cause: e });
      }
      throw e;
    }
    const intention = mapIntention(raw, { drift: this.drift, now: () => this.rt.clock.now() });
    if (intention.reference && intention.reference !== body.special_reference) {
      this.drift.record({ connector: "paymob", entity: "intention", kind: "shape_changed", field: "special_reference", detail: "the answer's reference differs from the one sent", at: this.rt.clock.now() });
    }
    return { ...intention, reference: body.special_reference };
  }

  /** The hosted page the customer pays on (the public key and this payment's client secret). */
  checkoutUrl(clientSecret: string): string {
    const u = new URL(`${PAYMOB_CHECKOUT[this.creds.region]}/`);
    u.searchParams.set("publicKey", this.creds.publicKey);
    u.searchParams.set("clientSecret", clientSecret);
    return u.toString();
  }

  /** The transaction as Paymob has it now (E14-2b maps it to the ledger). */
  async getTransaction(transactionId: string): Promise<unknown> {
    if (!/^\d{1,20}$/.test(transactionId)) throw new IntegrationError({ kind: "validation", connector: "paymob", message: "not a Paymob transaction id" });
    return this.rest.withToken("getTransaction", "GET", `/api/acceptance/transactions/${transactionId}`);
  }
}
