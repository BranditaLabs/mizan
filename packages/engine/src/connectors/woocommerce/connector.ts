import { editMarker, type OrderEditPlan } from "../../core/order-edit.js";
import { IntegrationError } from "../../core/errors.js";
import type { CanonicalOrder, CanonicalProduct, ProductPatch } from "@mizan/shared";
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
/** Mizan's product status → WooCommerce's (no archive there: a private product is out of the shop). */
const WOO_STATUS = { active: "publish", draft: "draft", archived: "private" } as const;

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
   * Push a product edited in Mizan (P2): name, description, status, tags, the pictures' order
   * (the first is the main picture; the list is complete, as WooCommerce keeps only the pictures
   * sent) and prices. Absolute values, so sending them twice changes nothing. A price with a
   * higher compare-at price is a sale (regular = compare-at, sale = price); without one, the
   * regular price and no sale. A simple product's prices are on the product; a variation's on
   * the variation. WooCommerce has no vendor or product type field (`validation`).
   */
  async applyProductPatch(patch: ProductPatch): Promise<void> {
    if (patch.vendor !== undefined || patch.productType !== undefined) {
      throw new IntegrationError({ kind: "validation", connector: "woocommerce", message: "WooCommerce products have no vendor or product type field" });
    }
    const id = patch.productExternalId;
    const body: Record<string, unknown> = {};
    if (patch.title !== undefined) body.name = patch.title;
    if (patch.descriptionHtml !== undefined) body.description = patch.descriptionHtml;
    if (patch.status !== undefined && patch.status !== "unknown") body.status = WOO_STATUS[patch.status];
    if (patch.tags !== undefined) body.tags = patch.tags.map((name) => ({ name }));
    if (patch.mediaOrder?.length) body.images = patch.mediaOrder.map((m) => ({ id: Number(m) }));
    const prices = (v: NonNullable<ProductPatch["variants"]>[number]) => {
      if (!v.price) return {};
      const cap = v.compareAtPrice && Number(v.compareAtPrice.amount) > Number(v.price.amount) ? v.compareAtPrice.amount : null;
      return cap ? { regular_price: cap, sale_price: v.price.amount } : { regular_price: v.price.amount, sale_price: "" };
    };
    for (const v of patch.variants ?? []) if (v.externalId === id) Object.assign(body, prices(v));
    if (Object.keys(body).length) await this.rest.write("updateProduct", "PUT", `/products/${encodeURIComponent(id)}`, body, true);
    for (const v of patch.variants ?? []) {
      if (v.externalId === id || !v.price) continue;
      await this.rest.write("updateVariation", "PUT", `/products/${encodeURIComponent(id)}/variations/${encodeURIComponent(v.externalId)}`, prices(v), true);
    }
  }

  /**
   * Change an order before it ships (O3) in one update: quantities (0 removes the line), new items,
   * prices, the delivery fee and the address; WooCommerce calculates the totals again. The update
   * carries the edit's marker in the order's meta, so it is written once: an order that has the
   * marker already has the edit, and an update whose answer was lost is checked by reading the
   * order, never sent twice (a new item would be added twice). A completed, cancelled or refunded
   * order is not edited (`validation`). Confirm on a real store that quantity 0 removes a line and
   * that totals follow (WooCommerce REST, orders).
   */
  async editOrder(plan: OrderEditPlan): Promise<"applied" | "already_applied"> {
    const path = `/orders/${encodeURIComponent(plan.orderId)}`;
    const key = editMarker(plan.editId);
    const read = async () => {
      const { json } = await this.rest.get<Record<string, unknown>>("getOrder", path);
      const r = new Resolver(json, { connector: "woocommerce", entity: "order", drift: this.drift, now: () => this.rt.clock.now() });
      const meta = r.arr<{ key?: unknown }>("meta_data", ["meta_data"]);
      const shipping = r.arr("shipping_lines", ["shipping_lines"]).map((x) => {
        const xr = r.child(x, "order.shippingLine");
        return { id: xr.str("id", ["id"]), title: xr.str("title", ["method_title"]) };
      });
      return { marked: meta.some((m) => m?.key === key), status: (r.str("status", ["status"]) ?? "").toLowerCase(), shipping };
    };
    const before = await read();
    if (before.marked) return "already_applied";
    if (["completed", "cancelled", "refunded", "failed", "trash"].includes(before.status)) {
      throw new IntegrationError({ kind: "validation", connector: "woocommerce", message: `order ${plan.orderId} is ${before.status} in the store: it cannot be edited` });
    }
    const total = (unit: string, qty: number) => (Number(unit) * qty).toFixed(2);
    const lineItems: Array<Record<string, unknown>> = plan.lines.map((l) => ({
      id: Number(l.lineId), quantity: l.quantity, ...(l.unitPrice !== undefined ? { subtotal: total(l.unitPrice, l.quantity), total: total(l.unitPrice, l.quantity) } : {}),
    }));
    for (const a of plan.add) {
      // A variant is a simple product or a variation: the store says which, and its parent.
      const { json } = await this.rest.get<Record<string, unknown>>("getProduct", `/products/${encodeURIComponent(a.variantId)}`);
      const pr = new Resolver(json, { connector: "woocommerce", entity: "product", drift: this.drift, now: () => this.rt.clock.now() });
      const variation = pr.str("type", ["type"]) === "variation";
      const parent = pr.str("parent", ["parent_id"]);
      if (variation && !parent) throw new IntegrationError({ kind: "schema_drift", connector: "woocommerce", message: `variation ${a.variantId} has no parent_id` });
      lineItems.push({
        product_id: Number(variation ? parent : a.variantId), ...(variation ? { variation_id: Number(a.variantId) } : {}), quantity: a.quantity,
        ...(a.unitPrice !== undefined ? { subtotal: total(a.unitPrice, a.quantity), total: total(a.unitPrice, a.quantity) } : {}),
      });
    }
    const body: Record<string, unknown> = { meta_data: [{ key, value: plan.editId }] };
    if (lineItems.length) body.line_items = lineItems;
    if (plan.shipping !== undefined) {
      const fee = Number(plan.shipping).toFixed(2);
      const [first, ...others] = before.shipping;
      body.shipping_lines = first?.id
        ? [{ id: Number(first.id), total: fee }, ...others.filter((x) => x.id).map((x) => ({ id: Number(x.id), method_id: null }))]
        : [{ method_id: "flat_rate", method_title: "Shipping", total: fee }];
    }
    if (plan.address) {
      const a = plan.address;
      const [first, ...rest] = (a.name ?? "").trim().split(/\s+/);
      body.shipping = {
        address_1: a.line1, address_2: a.line2 ?? "", city: a.city, state: a.province ?? "",
        ...(a.countryCode ? { country: a.countryCode } : {}), ...(a.phone ? { phone: a.phone } : {}),
        ...(first ? { first_name: first, last_name: rest.join(" ") } : {}),
      };
    }
    try {
      await this.rest.write("editOrder", "PUT", path, body, false);
    } catch (err) {
      if (!(err instanceof IntegrationError) || (err.kind !== "timeout" && err.kind !== "transient")) throw err;
      if (!(await read()).marked) throw new IntegrationError({ kind: "transient", connector: "woocommerce", message: "the order update got no answer and the order does not have the edit: will send it again", cause: err });
    }
    return "applied";
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
