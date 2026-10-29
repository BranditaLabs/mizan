import { IntegrationError } from "../../core/errors.js";
import type { CanonicalOrder, CanonicalProduct } from "@mizan/shared";
import type { Runtime } from "../../core/runtime.js";
import type { DriftSink } from "../../adapt/drift.js";
import { Resolver } from "../../adapt/resolve.js";
import type { ShapeWatch } from "../../adapt/shape.js";
import type { PAYMENT_PATTERNS } from "../shopify/mapper.js";
import { WooRest, type WooCommerceCredentials } from "./client.js";
import { mapWooOrder, mapWooProduct, parseWooStockTarget } from "./mapper.js";

/** Order topics Mizan subscribes to. */
export const WOO_WEBHOOK_TOPICS = ["order.created", "order.updated", "order.deleted", "product.created", "product.updated"] as const;

export interface WooLearned { queryStringAuth: boolean }

/**
 * WooCommerce connector (E5-7): reads orders and keeps the store's webhooks pointed at Mizan.
 * Reads only for now; the one write (webhooks) looks before it creates, so repeating it is safe.
 */
export class WooCommerceConnector {
  readonly id = "woocommerce";
  readonly rest: WooRest;

  constructor(readonly creds: WooCommerceCredentials, private readonly rt: Runtime, private readonly drift: DriftSink, shapes: ShapeWatch,
    private readonly opts: { paymentPatterns?: Partial<Record<keyof typeof PAYMENT_PATTERNS, RegExp[]>> } = {}) {
    this.rest = new WooRest(creds, rt, drift, shapes);
  }

  health() {
    return { circuit: this.rest.circuit.status, budget: this.rest.bucket.snapshot };
  }

  exportLearned(): WooLearned {
    return { queryStringAuth: this.rest.queryStringAuth };
  }

  loadLearned(state: Partial<WooLearned> | undefined) {
    if (typeof state?.queryStringAuth === "boolean") this.creds.queryStringAuth = state.queryStringAuth;
  }

  private ctx() {
    return { drift: this.drift, now: () => this.rt.clock.now(), ...(this.opts.paymentPatterns ? { paymentPatterns: this.opts.paymentPatterns } : {}) };
  }

  async getOrder(id: string): Promise<CanonicalOrder> {
    const { json } = await this.rest.get<unknown>("getOrder", `/orders/${encodeURIComponent(id)}`);
    if (!json || typeof json !== "object") throw new IntegrationError({ kind: "not_found", connector: "woocommerce", message: `order ${id} not found` });
    return mapWooOrder(json, this.ctx());
  }

  /** One page of orders modified at or after `sinceIso` (GMT), oldest change first; `next` is null on the last page. */
  async ordersPage(sinceIso: string, page = 1, perPage = 50): Promise<{ nodes: CanonicalOrder[]; next: number | null }> {
    const { json, totalPages } = await this.rest.get<unknown[]>("listOrders", "/orders", {
      modified_after: sinceIso.replace(/(\.\d+)?Z$/, ""), dates_are_gmt: true, orderby: "modified", order: "asc", status: "any", page, per_page: perPage,
    });
    const rows = Array.isArray(json) ? json : [];
    return { nodes: rows.map((o) => mapWooOrder(o, this.ctx())), next: page < totalPages && rows.length ? page + 1 : null };
  }

  async *ordersModifiedSince(sinceIso: string, perPage = 50): AsyncGenerator<CanonicalOrder[]> {
    let page: number | null = 1;
    while (page) {
      const r: { nodes: CanonicalOrder[]; next: number | null } = await this.ordersPage(sinceIso, page, perPage);
      yield r.nodes;
      page = r.next;
    }
  }

  /** A product with its variations (a variable product's are read in pages of 100). */
  async getProduct(id: string): Promise<CanonicalProduct> {
    const { json } = await this.rest.get<Record<string, unknown>>("getProduct", `/products/${encodeURIComponent(id)}`);
    if (!json || typeof json !== "object") throw new IntegrationError({ kind: "not_found", connector: "woocommerce", message: `product ${id} not found` });
    return mapWooProduct(json, await this.variationsOf(json), this.ctx());
  }

  /** One page of products modified at or after `sinceIso` (all when null), oldest change first. */
  async productsPage(sinceIso: string | null, page = 1, perPage = 50): Promise<{ nodes: CanonicalProduct[]; next: number | null }> {
    const { json, totalPages } = await this.rest.get<unknown[]>("listProducts", "/products", {
      ...(sinceIso ? { modified_after: sinceIso.replace(/(\.\d+)?Z$/, ""), dates_are_gmt: true } : {}), orderby: "modified", order: "asc", status: "any", page, per_page: perPage,
    });
    const rows = (Array.isArray(json) ? json : []) as Array<Record<string, unknown>>;
    const nodes: CanonicalProduct[] = [];
    for (const p of rows) nodes.push(mapWooProduct(p, await this.variationsOf(p), this.ctx()));
    return { nodes, next: page < totalPages && rows.length ? page + 1 : null };
  }

  /**
   * Cancel the store's order (E5-4 for WooCommerce): read first (already cancelled → done), then
   * set the status — an absolute value, safe to send again, so a timeout is simply retried.
   * WooCommerce puts the stock back itself on cancellation. A completed or refunded order is not
   * cancelled (its money goes back through a refund). The team's note is added once: a note
   * with the same text already on the order is not written again.
   */
  async cancelOrder(o: { orderId: string; note?: string | undefined }): Promise<"cancelled" | "already_cancelled"> {
    const current = await this.getOrder(o.orderId);
    const status = (current.financialStatus ?? "").toLowerCase();
    if (current.cancelled || status === "cancelled") return "already_cancelled";
    if (status === "completed" || status === "refunded") {
      throw new IntegrationError({ kind: "validation", connector: "woocommerce", message: `order ${o.orderId} is ${status} in the store: refund it instead of cancelling` });
    }
    await this.rest.write("cancelOrder", "PUT", `/orders/${encodeURIComponent(o.orderId)}`, { status: "cancelled" }, true);
    if (o.note) {
      const { json } = await this.rest.get<Array<{ note?: unknown }>>("listOrderNotes", `/orders/${encodeURIComponent(o.orderId)}/notes`, { type: "internal" });
      const exists = Array.isArray(json) && json.some((n) => typeof n?.note === "string" && n.note.trim() === o.note!.trim());
      if (!exists) await this.rest.write("addOrderNote", "POST", `/orders/${encodeURIComponent(o.orderId)}/notes`, { note: o.note, customer_note: false });
    }
    return "cancelled";
  }

  /**
   * Set the stock count where it lives (E8-5): an absolute value, so sending it twice changes
   * nothing. `manage_stock` is sent too, as it already was on for this record (the target exists
   * only for managed stock), so a merchant who turned it off meanwhile gets it back on, never a
   * silently ignored count.
   */
  async setStock(target: string, quantity: number): Promise<void> {
    const t = parseWooStockTarget(target);
    if (!t) throw new IntegrationError({ kind: "validation", connector: "woocommerce", message: `not a stock target: ${target}` });
    const path = t.variationId ? `/products/${t.productId}/variations/${t.variationId}` : `/products/${t.productId}`;
    await this.rest.write("setStock", "PUT", path, { manage_stock: true, stock_quantity: Math.max(0, Math.trunc(quantity)) }, true);
  }

  private async variationsOf(product: Record<string, unknown>): Promise<unknown[]> {
    if (String(product.type ?? "").toLowerCase() !== "variable") return [];
    const out: unknown[] = [];
    for (let page = 1; ; page++) {
      const { json, totalPages } = await this.rest.get<unknown[]>("listVariations", `/products/${encodeURIComponent(String(product.id))}/variations`, { page, per_page: 100 });
      out.push(...(Array.isArray(json) ? json : []));
      if (page >= totalPages) return out;
    }
  }

  /**
   * Point the store's order and product webhooks at Mizan: look up what exists (by delivery URL and topic),
   * turn a disabled or paused one back on (WooCommerce disables a webhook after 5 failed
   * deliveries), create what is missing. Safe to repeat; a create that timed out is found by the
   * next run's look-up instead of being sent twice.
   */
  async syncWebhooks(): Promise<{ created: string[]; reactivated: string[] }> {
    const url = this.creds.webhookUrl;
    if (!url) throw new IntegrationError({ kind: "validation", connector: "woocommerce", message: "no webhook URL configured" });
    const existing: Array<{ id: string; topic: string; status: string }> = [];
    for (let page = 1; ; page++) {
      const { json, totalPages } = await this.rest.get<unknown[]>("listWebhooks", "/webhooks", { page, per_page: 100 });
      for (const w of Array.isArray(json) ? json : []) {
        const r = new Resolver(w, { connector: "woocommerce", entity: "webhook", drift: this.drift, now: () => this.rt.clock.now() });
        if ((r.str("delivery_url", ["delivery_url"]) ?? "") !== url) continue;
        existing.push({ id: r.str("id", ["id"], { required: true })!, topic: r.str("topic", ["topic"]) ?? "", status: r.str("status", ["status"]) ?? "" });
      }
      if (page >= totalPages) break;
    }
    const created: string[] = [];
    const reactivated: string[] = [];
    for (const topic of WOO_WEBHOOK_TOPICS) {
      const mine = existing.filter((w) => w.topic === topic);
      if (!mine.length) {
        await this.rest.write("createWebhook", "POST", "/webhooks", { name: `Mizan ${topic}`, topic, delivery_url: url, secret: this.creds.webhookSecret, status: "active" });
        created.push(topic);
        continue;
      }
      for (const w of mine.filter((x) => x.status !== "active")) {
        // Setting the status and secret is absolute: sending it twice changes nothing.
        await this.rest.write("updateWebhook", "PUT", `/webhooks/${encodeURIComponent(w.id)}`, { status: "active", secret: this.creds.webhookSecret }, true);
        reactivated.push(topic);
      }
    }
    return { created, reactivated };
  }
}
