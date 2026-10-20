import { hang, json, type FakeClock } from "./clock.js";

/**
 * In-memory Bosta v2. Keeps deliveries and can misbehave: 429 with
 * Retry-After, 5xx, hangs, "lost response" on create (the delivery is
 * created but the caller never hears back), and payload shape changes
 * (state as {code, value} object vs bare number; renamed tracking field).
 */

type Fault = "500" | "429" | "timeout" | "network";
export type Shape = "object" | "flat" | "renamed" | "codeOnly";

interface Delivery {
  _id: string; trackingNumber: string; businessReference: string; cod: number;
  state: { code: number; value: string }; dropOffAddress: Record<string, unknown>; receiver: Record<string, unknown>; updatedAt: string;
}

export const CITIES = [
  { _id: "c-cairo", name: "Cairo", nameAr: "القاهرة" },
  { _id: "c-giza", name: "Giza", nameAr: "الجيزة" },
  { _id: "c-alex", name: "Alexandria", nameAr: "الإسكندرية" },
  { _id: "c-assiut", name: "Assiut", nameAr: "أسيوط" },
  { _id: "c-dakahlia", name: "Dakahlia", nameAr: "الدقهلية" },
  { _id: "c-sharqia", name: "Sharqia", nameAr: "الشرقية" },
];

export class FakeBosta {
  readonly host = "fake-bosta.test";
  readonly apiKey = "bosta-key-123";
  deliveries = new Map<string, Delivery>();
  calls: Array<{ method: string; path: string }> = [];
  faults: Array<{ path?: string; fault: Fault }> = [];
  randomFaultRate = 0;
  shape: Shape = "object";
  /** Create succeeds server-side, but the response never reaches the client. */
  loseNextCreateResponses = 0;
  private seq = 7_000_000;

  constructor(private readonly clock: FakeClock, private readonly random: () => number = Math.random) {}

  get baseUrl() {
    return `https://${this.host}/api/v2`;
  }

  setState(tn: string, code: number, value: string) {
    const d = this.deliveries.get(tn)!;
    d.state = { code, value };
    d.updatedAt = new Date(this.clock.now()).toISOString();
  }

  /** Webhook body: Bosta sends a minimal payload; the engine re-reads the delivery. */
  webhook(tn: string, opts: { withLabel?: boolean } = {}) {
    const d = this.deliveries.get(tn)!;
    return JSON.stringify({
      _id: d._id, trackingNumber: tn, state: opts.withLabel ? { code: d.state.code, value: d.state.value } : d.state.code,
      type: "SEND", timeStamp: this.clock.now(), cod: d.cod, businessReference: d.businessReference,
    });
  }

  private render(d: Delivery) {
    const base = { _id: d._id, businessReference: d.businessReference, cod: d.cod, dropOffAddress: d.dropOffAddress, receiver: d.receiver, updatedAt: d.updatedAt };
    if (this.shape === "flat") return { ...base, trackingNumber: d.trackingNumber, state: d.state.code, stateValue: d.state.value };
    if (this.shape === "codeOnly") return { ...base, trackingNumber: d.trackingNumber, state: d.state.code };
    if (this.shape === "renamed") return { ...base, tracking_number: d.trackingNumber, state: { code: d.state.code, value: d.state.value } };
    return { ...base, trackingNumber: d.trackingNumber, state: d.state };
  }

  handler = async (url: URL, init: RequestInit): Promise<Response> => {
    const method = String(init.method ?? "GET");
    const path = url.pathname.replace(/^\/api\/v2\//, "");
    if ((init.headers as Record<string, string>)?.Authorization !== this.apiKey) return json(401, { success: false, message: "Unauthorized" });

    const fi = this.faults.findIndex((f) => !f.path || path.startsWith(f.path));
    let fault: Fault | undefined = fi >= 0 ? this.faults.splice(fi, 1)[0].fault : undefined;
    if (!fault && this.randomFaultRate && this.random() < this.randomFaultRate) fault = (["500", "429", "timeout", "network"] as Fault[])[Math.floor(this.random() * 4)];
    if (fault === "500") return json(503, { success: false, message: "Service unavailable" });
    if (fault === "429") return json(429, { success: false, message: "Too many requests" }, { "Retry-After": "2" });
    if (fault === "network") throw new TypeError("fetch failed: socket hang up");
    if (fault === "timeout") return hang(init);

    this.calls.push({ method, path });
    const body = init.body ? JSON.parse(String(init.body)) : undefined;

    if (method === "GET" && path === "cities") return json(200, { success: true, data: CITIES });

    if (method === "POST" && path === "deliveries") {
      const city = body?.dropOffAddress?.city;
      if (!CITIES.some((c) => c.name === city)) return json(400, { success: false, message: `City ${city} is not supported` });
      if (!/^01[0125]\d{8}$/.test(body?.receiver?.phone ?? "")) return json(400, { success: false, message: "Invalid receiver phone" });
      const tn = String(++this.seq);
      const d: Delivery = {
        _id: `d-${tn}`, trackingNumber: tn, businessReference: body.businessReference, cod: body.cod,
        state: { code: 10, value: "Pickup requested" }, dropOffAddress: body.dropOffAddress, receiver: body.receiver,
        updatedAt: new Date(this.clock.now()).toISOString(),
      };
      this.deliveries.set(tn, d);
      if (this.loseNextCreateResponses > 0) {
        this.loseNextCreateResponses--;
        return hang(init);
      }
      return json(201, { success: true, message: "Delivery created", data: { _id: d._id, trackingNumber: tn } });
    }

    if (method === "POST" && path === "deliveries/search") {
      const hits = [...this.deliveries.values()].filter((d) => !body?.businessReference || d.businessReference === body.businessReference);
      return json(200, { success: true, data: { deliveries: hits.map((d) => this.render(d)), count: hits.length } });
    }

    const m = path.match(/^deliveries\/business\/([^/]+)(\/terminate)?$/);
    if (m) {
      const d = this.deliveries.get(decodeURIComponent(m[1]));
      if (!d) return json(404, { success: false, message: "Delivery not found" });
      if (method === "DELETE" && m[2]) {
        d.state = { code: 48, value: "Terminated" };
        return json(200, { success: true, message: "Terminated" });
      }
      return json(200, { success: true, data: this.render(d) });
    }
    return json(404, { success: false, message: `No route ${method} ${path}` });
  };

  count(method: string, path: string) {
    return this.calls.filter((c) => c.method === method && c.path === path).length;
  }
}
