import { timingSafeEqual } from "node:crypto";
import { IntegrationError } from "../../core/errors.js";
import type { CanonicalOrder, CanonicalShipment, ShipmentStatus } from "../../core/model.js";
import { TERMINAL_STATUSES } from "../../core/model.js";
import type { Runtime } from "../../core/runtime.js";
import type { DriftSink } from "../../adapt/drift.js";
import { Resolver } from "../../adapt/resolve.js";
import type { ShapeWatch } from "../../adapt/shape.js";
import { StatusMapper } from "../../adapt/status.js";
import { CircuitBreaker } from "../../resilience/circuit.js";
import { send, type HttpResponse } from "../../resilience/http.js";
import { AdaptiveBucket } from "../../resilience/limiter.js";
import { CityResolver, normalize, type BostaCity } from "./cities.js";
import { BOSTA_STATUS_CONFIG } from "./states.js";

export interface BostaConfig {
  apiKey: string;
  /** Production default; staging/sandbox URL comes from your Bosta account. */
  baseUrl?: string;
  /** Shared secret appended to the webhook URL (`?token=`); Bosta webhooks carry no signature. */
  webhookSecret: string;
  /** Public URL Bosta should call on state changes, set per delivery. */
  webhookUrl?: string;
  /** Field name Bosta expects for the city in dropOffAddress. */
  cityField?: "city" | "cityCode" | "cityId";
  packageSize?: "SMALL" | "MEDIUM" | "LARGE";
  allowToOpenPackage?: boolean;
  /** e.g. "https://bosta.co/tracking-shipments?shipment-number={tn}" — confirm the public tracking URL with Bosta. */
  trackingUrlTemplate?: string;
}

/** Learned code → status pairs with how often each was confirmed by a label. */
export interface LearnedStatus {
  status: ShipmentStatus;
  confirmations: number;
  conflicts: number;
}

const DELIVERY_TYPE_SEND = 10; // Bosta delivery type: forward package delivery (official SDK constant)

/**
 * Bosta connector.
 *
 * Duplicate-safe shipment creation: Bosta's create call has no idempotency
 * key. If a create times out, the delivery may or may not exist. The engine
 * never blindly re-sends: on any retry it first searches Bosta by our
 * businessReference (the Mizan order id) and adopts the existing delivery.
 *
 * Thin webhook, fat fetch: a webhook is only a hint that something changed.
 * The connector re-reads the delivery from Bosta's API before acting, so a
 * forged, partial or out-of-date webhook can never move an order by itself.
 */
export class BostaConnector {
  readonly id = "bosta";
  readonly circuit: CircuitBreaker;
  readonly bucket: AdaptiveBucket;
  readonly statuses: StatusMapper;
  private cityResolver?: { at: number; resolver: CityResolver };
  private readonly learnedCodes = new Map<string, LearnedStatus>();
  private readonly learnedCities = new Map<string, string>();

  constructor(private readonly cfg: BostaConfig, private readonly rt: Runtime, private readonly drift: DriftSink, private readonly shapes: ShapeWatch) {
    this.circuit = new CircuitBreaker("bosta", rt.clock, { failureThreshold: 5, openMs: 30_000 });
    // Bosta does not publish limits; start conservative and let AIMD find the real pace.
    this.bucket = new AdaptiveBucket(rt.clock, { capacity: 10, refillPerSec: 5 });
    this.statuses = new StatusMapper(BOSTA_STATUS_CONFIG, drift, () => rt.clock.now(), (code) => this.learnedCodes.has(code));
  }

  private get base() {
    return (this.cfg.baseUrl ?? "https://app.bosta.co/api/v2").replace(/\/+$/, "");
  }

  private resolver(source: unknown, entity: string) {
    return new Resolver(source, { connector: "bosta", entity, drift: this.drift, now: () => this.rt.clock.now() });
  }

  private async call(op: string, method: "GET" | "POST" | "PUT" | "DELETE", path: string, body: unknown, idempotent: boolean): Promise<unknown> {
    const res = await send(this.rt, {
      connector: "bosta", op: `bosta.${op}`, method, url: `${this.base}/${path.replace(/^\//, "")}`,
      headers: { Authorization: this.cfg.apiKey }, // raw key, no "Bearer" prefix
      body, idempotent, timeoutMs: 15_000, maxAttempts: idempotent ? 5 : 3,
      inspect: (r) => this.inspect(op, r),
    }, { circuit: this.circuit, bucket: this.bucket });
    const r = this.resolver(res.json, op);
    const data = r.any("data", ["data", "result", "delivery"]) ?? res.json; // envelope {success, message, data} — or bare
    const diff = this.shapes.observe(`bosta:${op}`, data);
    if (diff && (diff.removed.length || diff.retyped.length)) {
      this.drift.record({ connector: "bosta", entity: op, kind: "shape_changed", detail: `removed: ${diff.removed.slice(0, 10).join(", ") || "—"}; retyped: ${diff.retyped.slice(0, 10).join(", ") || "—"}`, at: this.rt.clock.now() });
    }
    return data;
  }

  /** Bosta can answer HTTP 200 with `success: false`. */
  private inspect(op: string, res: HttpResponse): IntegrationError | null {
    const b = res.json as { success?: boolean; message?: string; errorCode?: string | number } | undefined;
    if (b && b.success === false) {
      const msg = b.message ?? "request rejected";
      const kind = /not found|does not exist/i.test(msg) ? "not_found" : /rate|too many/i.test(msg) ? "rate_limited" : /unauthori|api key|token/i.test(msg) ? "auth" : "validation";
      return new IntegrationError({ kind, connector: "bosta", message: `${op}: ${msg}`, details: b });
    }
    return null;
  }

  // ───────────── cities ─────────────

  async cities(): Promise<CityResolver> {
    const day = 24 * 3600_000;
    if (this.cityResolver && this.rt.clock.now() - this.cityResolver.at < day) return this.cityResolver.resolver;
    const data = await this.call("cities", "GET", "cities", undefined, true);
    const r = this.resolver(data, "cities");
    const list = Array.isArray(data) ? data : r.arr("list", ["list", "cities", "data"]);
    const cities: BostaCity[] = list.map((c) => {
      const cr = r.child(c, "city");
      return {
        id: cr.str("id", ["_id", "id"], { required: true })!,
        name: cr.str("name", ["name", "nameEn", "name.en"], { required: true })!,
        nameAr: cr.str("nameAr", ["nameAr", "name_ar", "arabicName", "name.ar"]),
        code: cr.str("code", ["code", "cityCode"]),
      };
    });
    const resolver = new CityResolver(cities, this.learnedCities);
    this.cityResolver = { at: this.rt.clock.now(), resolver };
    return resolver;
  }

  /** Called when ops picks the city for an address the resolver could not match. */
  learnCityAlias(text: string, cityId: string) {
    this.learnedCities.set(normalize(text), cityId);
  }

  loadLearned(state: { codes?: Record<string, LearnedStatus>; cities?: Record<string, string> }) {
    for (const [k, v] of Object.entries(state.codes ?? {})) this.learnedCodes.set(k, v);
    for (const [k, v] of Object.entries(state.cities ?? {})) this.learnedCities.set(k, v);
  }

  exportLearned() {
    return { codes: Object.fromEntries(this.learnedCodes), cities: Object.fromEntries(this.learnedCities) };
  }

  // ───────────── shipments ─────────────

  async buildDeliveryPayload(order: CanonicalOrder, reference: string): Promise<Record<string, unknown>> {
    const a = order.shippingAddress;
    if (!a?.line1) throw new IntegrationError({ kind: "validation", connector: "bosta", message: `order ${order.number}: no shipping address` });
    const phone = normalizeEgPhone(a.phone ?? order.customer.phone);
    if (!phone) throw new IntegrationError({ kind: "validation", connector: "bosta", message: `order ${order.number}: no valid receiver phone` });
    const resolver = await this.cities();
    const match = resolver.resolve(a.city, a.province);
    if (!match) {
      const s = resolver.suggest(a.city || a.province).map((c) => c.name).join(", ");
      throw new IntegrationError({
        kind: "validation", connector: "bosta",
        message: `order ${order.number}: city "${a.city}" / "${a.province ?? ""}" not recognised by Bosta. Closest: ${s}. Pick the city once and it is remembered.`,
        details: { city: a.city, province: a.province, suggestions: s },
      });
    }
    const cityField = this.cfg.cityField ?? "city";
    const cityValue = cityField === "cityId" ? match.city.id : cityField === "cityCode" ? match.city.code ?? match.city.name : match.city.name;
    const [firstName, ...rest] = (a.name ?? order.customer.name ?? "Customer").trim().split(/\s+/);
    const items = order.lines.reduce((n, l) => n + l.quantity, 0);
    const cod = order.paymentMode === "cod" ? Number(order.total.amount) : 0;
    return {
      type: DELIVERY_TYPE_SEND,
      specs: {
        size: this.cfg.packageSize ?? "SMALL",
        packageType: "Parcel",
        packageDetails: { itemsCount: Math.max(1, items), description: order.lines.map((l) => `${l.quantity}× ${l.title}`).join(", ").slice(0, 200) },
      },
      cod,
      dropOffAddress: { [cityField]: cityValue, firstLine: a.line1, ...(a.line2 ? { secondLine: a.line2 } : {}) },
      receiver: { firstName: firstName || "Customer", lastName: rest.join(" ") || "-", phone, ...(order.customer.email ? { email: order.customer.email } : {}) },
      businessReference: reference,
      notes: `Mizan order ${order.number}`,
      allowToOpenPackage: this.cfg.allowToOpenPackage ?? false,
      ...(this.cfg.webhookUrl ? { webhookUrl: `${this.cfg.webhookUrl}${this.cfg.webhookUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(this.cfg.webhookSecret)}` } : {}),
    };
  }

  /**
   * Create a delivery exactly once per reference.
   * `verifyFirst` is true on any retry: a previous attempt may have succeeded.
   */
  async createShipmentOnce(order: CanonicalOrder, reference: string, verifyFirst: boolean): Promise<{ shipment: CanonicalShipment; adopted: boolean }> {
    if (verifyFirst) {
      const existing = await this.findByReference(reference);
      if (existing) return { shipment: existing, adopted: true };
    }
    const payload = await this.buildDeliveryPayload(order, reference);
    try {
      const data = await this.call("createDelivery", "POST", "deliveries?apiVersion=1", payload, false);
      const r = this.resolver(data, "delivery");
      const tn = r.str("trackingNumber", ["trackingNumber", "tracking_number", "delivery.trackingNumber"], { required: true })!;
      // Read it back: the create response is minimal and its shape is not guaranteed.
      const full = await this.getShipment(tn).catch(() => undefined);
      return {
        shipment: full ?? {
          connector: "bosta", externalId: r.str("id", ["_id", "id"]) ?? tn, trackingNumber: tn, orderRef: reference, status: "created",
          rawStatus: {}, cod: { amount: String(payload.cod), currency: "EGP" }, trackingUrl: this.trackingUrl(tn), updatedAt: new Date(this.rt.clock.now()).toISOString(),
        },
        adopted: false,
      };
    } catch (e) {
      // Outcome unknown (timeout, connection dropped): check before anyone retries.
      if (e instanceof IntegrationError && (e.kind === "timeout" || e.kind === "transient")) {
        const existing = await this.findByReference(reference).catch(() => undefined);
        if (existing) return { shipment: existing, adopted: true };
      }
      throw e;
    }
  }

  async findByReference(reference: string): Promise<CanonicalShipment | undefined> {
    const data = await this.call("searchDeliveries", "POST", "deliveries/search", { businessReference: reference }, true);
    const r = this.resolver(data, "search");
    const list = Array.isArray(data) ? data : r.arr("deliveries", ["deliveries", "list", "data", "results"]);
    const hit = list.find((d) => this.resolver(d, "delivery").str("businessReference", ["businessReference", "business_reference"]) === reference);
    return hit ? this.toShipment(hit, reference) : undefined;
  }

  async getShipment(trackingNumber: string): Promise<CanonicalShipment> {
    const data = await this.call("getDelivery", "GET", `deliveries/business/${encodeURIComponent(trackingNumber)}`, undefined, true);
    return this.toShipment(data);
  }

  async cancelShipment(trackingNumber: string): Promise<void> {
    await this.call("terminateDelivery", "DELETE", `deliveries/business/${encodeURIComponent(trackingNumber)}/terminate`, undefined, true);
  }

  trackingUrl(tn: string) {
    return this.cfg.trackingUrlTemplate?.replace("{tn}", encodeURIComponent(tn));
  }

  /** Normalize a Bosta delivery, whatever shape it arrives in. */
  toShipment(raw: unknown, referenceHint?: string): CanonicalShipment {
    const r = this.resolver(raw, "delivery");
    const tn = r.str("trackingNumber", ["trackingNumber", "tracking_number", "trackingNo"], { required: true })!;
    const { code: codeVal, label } = readState(r);
    const status = this.mapStatus({ code: codeVal, label }, raw);
    const ts = r.any("timestamp", ["updatedAt", "state.updatedAt", "timeStamp", "timestamp", "lastUpdate"]);
    const updatedAt = typeof ts === "number" ? new Date(ts < 1e12 ? ts * 1000 : ts).toISOString() : typeof ts === "string" ? new Date(ts).toISOString() : new Date(this.rt.clock.now()).toISOString();
    return {
      connector: "bosta",
      externalId: r.str("id", ["_id", "id"]) ?? tn,
      trackingNumber: tn,
      orderRef: r.str("businessReference", ["businessReference", "business_reference"]) ?? referenceHint ?? "",
      status,
      rawStatus: { code: codeVal, label },
      cod: { amount: String(r.num("cod", ["cod", "codAmount", "cashOnDelivery"]) ?? 0), currency: "EGP" },
      trackingUrl: this.trackingUrl(tn),
      updatedAt,
      raw,
    };
  }

  /**
   * Status mapping that learns. Label match is the source of truth; when a
   * code arrives with a label, the pair is learned. When a code arrives alone
   * (e.g. a webhook), a learned pair is used, but a terminal status is only
   * trusted after 3 consistent label confirmations and no conflicts.
   */
  mapStatus(raw: { code?: string | number; label?: string }, sample?: unknown): ShipmentStatus {
    const code = raw.code === undefined ? undefined : String(raw.code);
    const mapped = this.statuses.map(raw, sample);
    if (code && raw.label && mapped.via === "label") {
      const cur = this.learnedCodes.get(code);
      if (!cur) this.learnedCodes.set(code, { status: mapped.status, confirmations: 1, conflicts: 0 });
      else if (cur.status === mapped.status) cur.confirmations += 1;
      else cur.conflicts += 1;
    }
    if (mapped.via !== "unknown") return mapped.status;
    if (code) {
      const learned = this.learnedCodes.get(code);
      if (learned && learned.conflicts === 0) {
        const trusted = !TERMINAL_STATUSES.has(learned.status) || learned.confirmations >= 3;
        if (trusted) return learned.status;
      }
    }
    return "unknown";
  }

  // ───────────── webhooks ─────────────

  verifyWebhook(token: string | undefined): boolean {
    if (!token) return false;
    const a = Buffer.from(token);
    const b = Buffer.from(this.cfg.webhookSecret);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /** Extract the hint from a webhook body; the engine then re-reads the delivery. */
  parseWebhook(body: unknown): { trackingNumber: string; code?: string | number; label?: string; at?: number } {
    const r = this.resolver(body, "webhook");
    const tn = r.str("trackingNumber", ["trackingNumber", "tracking_number", "delivery.trackingNumber", "data.trackingNumber"], { required: true })!;
    const { code, label } = readState(r);
    const ts = r.num("timeStamp", ["timeStamp", "timestamp", "updatedAt"]);
    return { trackingNumber: tn, code, label, at: ts === undefined ? undefined : ts < 1e12 ? ts * 1000 : ts };
  }

  health() {
    return { circuit: this.circuit.status, budget: this.bucket.snapshot, learnedCodes: this.learnedCodes.size };
  }
}

/**
 * Bosta sends the state either as an object ({ code, value }) or as a bare
 * code with the label alongside. Both are normal; neither is drift. A switch
 * between them is still caught by the shape watcher on the endpoint.
 */
function readState(r: Resolver): { code?: string | number; label?: string } {
  const s = r.any("state", ["state", "status", "stateCode"]);
  if (s && typeof s === "object") {
    const o = s as Record<string, unknown>;
    const code = o.code ?? o.id;
    const label = o.value ?? o.name ?? o.label;
    return {
      code: typeof code === "number" || typeof code === "string" ? code : undefined,
      label: typeof label === "string" ? label : undefined,
    };
  }
  return {
    code: typeof s === "number" || typeof s === "string" ? s : undefined,
    label: r.str("stateValue", ["stateValue", "statusName", "state_value", "stateName"]),
  };
}

/** Egyptian mobile numbers → 01XXXXXXXXX (Bosta's local format). Non-Egyptian numbers are passed through. */
export function normalizeEgPhone(p: string | undefined): string | undefined {
  if (!p) return undefined;
  const digits = p.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[^\d+]/g, "");
  const m = digits.match(/^(?:\+?20|0020)?0?(1[0125]\d{8})$/);
  if (m) return `0${m[1]}`;
  return digits.length >= 8 ? digits : undefined;
}
