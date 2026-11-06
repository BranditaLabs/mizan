import { describe, expect, it } from "vitest";
import { DriftMonitor } from "../src/adapt/drift.js";
import { isIntegrationError } from "../src/core/errors.js";
import { WhatsAppCloudConnector } from "../src/connectors/whatsapp/connector.js";
import { afterUnknownSend, parseWhatsAppWebhook, verifyMetaSignature } from "../src/connectors/whatsapp/webhooks.js";
import { MemoryStore } from "../src/sync/store.js";
import { OutboxWorker } from "../src/sync/worker.js";
import { FakeClock, seeded, testRuntime } from "./fakes/clock.js";
import { FakeWhatsApp } from "./fakes/whatsapp.js";

/**
 * WhatsApp confirmations end to end under chaos (E6-4): Meta failing a share of sends (5xx, body-coded
 * throughput limits, hangs, dropped connections, and messages accepted whose response is lost),
 * webhooks duplicated and out of order, customers double-tapping. The driver does what the
 * confirmation step outbox does (apps/api, E6-10): send, retry what is retryable, never re-send an
 * unknown outcome until `afterUnknownSend` says the status webhook did not come.
 * Required: every customer gets the message exactly once, every answer counts once, nothing dead.
 */
interface Item { key: string; to: string; state: "pending" | "unknown" | "sent" | "dead"; nextAt: number; sentAt: number; ref?: string }

describe("WhatsApp under chaos", () => {
  it.each([0.1, 0.25, 0.5])("50 confirmations with %s of calls failing: each sent once, each answer applied once", async (rate) => {
    const seed = Number(process.env.CHAOS_SEED ?? 0);
    const clock = new FakeClock();
    const wa = new FakeWhatsApp(clock, seeded(21 + seed * 7));
    wa.randomFaultRate = rate;
    wa.duplicateRate = 0.3;
    wa.shuffle = true;
    const drift = new DriftMonitor();
    const c = new WhatsAppCloudConnector({ phoneNumberId: wa.phoneNumberId, wabaId: wa.wabaId, accessToken: wa.token, baseUrl: wa.baseUrl },
      testRuntime(clock, { [wa.host]: wa.handler }, seeded(22 + seed * 7)), drift);

    const items: Item[] = Array.from({ length: 50 }, (_, i) => ({ key: `step-${i}`, to: `+2010${String(10_000_000 + i)}`, state: "pending", nextAt: 0, sentAt: 0 }));
    const byKey = new Map(items.map((x) => [x.key, x]));
    const seenStatus = new Set<string>();
    const keysWithStatus = new Set<string>();
    const seenMessages = new Set<string>();
    const answered = new Map<string, number>();
    const rnd = seeded(23 + seed * 7);
    let unknowns = 0;

    const pump = () => {
      for (const w of wa.takeWebhooks()) {
        expect(verifyMetaSignature(w.body, w.signature, wa.appSecret)).toBe(true);
        const p = parseWhatsAppWebhook(JSON.parse(w.body), drift, () => clock.now());
        for (const s of p.statuses) {
          if (seenStatus.has(`${s.id}:${s.status}`)) continue; // duplicate delivery
          seenStatus.add(`${s.id}:${s.status}`);
          if (s.key) keysWithStatus.add(s.key);
          const item = s.key ? byKey.get(s.key) : undefined;
          if (item && item.state === "unknown") { item.state = "sent"; item.ref = s.id; }
        }
        for (const m of p.messages) {
          if (seenMessages.has(m.id)) continue;
          seenMessages.add(m.id);
          const key = m.reply?.startsWith("confirm:") ? m.reply.slice(8) : undefined;
          // A run answers once: a second tap (or a re-delivered one) changes nothing.
          if (key && byKey.has(key) && !answered.has(key)) answered.set(key, 1);
        }
      }
    };

    for (let round = 0; round < 400 && items.some((x) => x.state === "pending" || x.state === "unknown"); round++) {
      for (const it of items) {
        if (it.state === "unknown") {
          const next = afterUnknownSend(it.sentAt, keysWithStatus.has(it.key), clock.now());
          if (next === "sent") it.state = "sent";
          if (next === "resend") { it.state = "pending"; it.nextAt = clock.now(); }
        }
        if (it.state !== "pending" || it.nextAt > clock.now()) continue;
        try {
          const r = await c.sendTemplate({ to: it.to, key: it.key, template: "mizan_order_confirm_ar", lang: "ar", params: ["منى", "#7001"], quickReplies: [`confirm:${it.key}`, `change:${it.key}`, `cancel:${it.key}`] });
          it.state = "sent";
          it.ref = r.ref;
        } catch (e) {
          if (!isIntegrationError(e)) throw e;
          if (e.kind === "timeout") { it.state = "unknown"; it.sentAt = clock.now(); unknowns++; }
          else if (e.retryable) it.nextAt = clock.now() + 60_000;
          else it.state = "dead";
        }
      }
      pump();
      clock.advance(60_000);
    }

    // Customers answer; some tap twice.
    wa.randomFaultRate = 0;
    for (const it of items) {
      const from = it.to.replace(/\D/g, "");
      wa.tapQuickReply(from, `confirm:${it.key}`, it.ref);
      if (rnd() < 0.2) wa.tapQuickReply(from, `confirm:${it.key}`, it.ref);
    }
    wa.deliverAll();
    pump();

    if (rate === 0.5) expect(unknowns).toBeGreaterThan(0); // lost responses and hangs really happened
    expect(items.filter((x) => x.state !== "sent").map((x) => `${x.key}:${x.state}`)).toEqual([]); // nothing lost, nothing dead
    for (const it of items) expect(wa.sentWithKey(it.key), it.key).toHaveLength(1); // no customer messaged twice
    expect([...answered.keys()].sort()).toEqual(items.map((x) => x.key).sort());
    expect([...answered.values()].every((n) => n === 1)).toBe(true);
  });

  /**
   * E6-16d: owners submitting the confirmation template from Mizan, as outbox jobs (one per name,
   * idempotency key per number and name), while Meta fails a share of calls, hangs, and loses the
   * answer to creates it made. Required: every template created exactly once, every job done, an
   * empty dead letter, and a submit pressed twice is one job.
   */
  it.each([0.1, 0.25, 0.5])("20 template submissions with %s of calls failing: each created once, none dead", async (rate) => {
    const seed = Number(process.env.CHAOS_SEED ?? 0);
    const clock = new FakeClock();
    const wa = new FakeWhatsApp(clock, seeded(51 + seed * 7));
    wa.randomFaultRate = rate;
    const rt = testRuntime(clock, { [wa.host]: wa.handler }, seeded(52 + seed * 7));
    const c = new WhatsAppCloudConnector({ phoneNumberId: wa.phoneNumberId, wabaId: wa.wabaId, accessToken: wa.token, baseUrl: wa.baseUrl }, rt, new DriftMonitor());
    const store = new MemoryStore();
    const worker = new OutboxWorker(store, rt, {
      "whatsapp.createTemplate": async (job) => {
        const p = job.payload as { name: string };
        await c.createTemplate({ name: p.name, language: "ar", category: "UTILITY", body: "👋 {{1}}\nطلبك {{3}} من {{2}}.\nالإجمالي {{4}}.", example: ["أهلاً منى", "متجر النيل", "#1001", "1,250 ج.م."], buttons: ["أكّد", "عدّل", "ألغِ"] });
      },
    });
    const names = Array.from({ length: 20 }, (_, i) => `mizan_chaos_${i}`);
    for (const name of names) {
      for (let press = 0; press < 2; press++) await store.enqueue({ kind: "whatsapp.createTemplate", connection: "whatsapp", payload: { name }, idempotencyKey: `wa-template:conn-1:${name}` }, clock.now());
    }
    for (let round = 0; round < 300; round++) {
      await worker.tick();
      if ((await store.jobs()).every((j) => j.status === "done" || j.status === "dead")) break;
      clock.advance(5 * 60_000);
    }
    const jobs = await store.jobs();
    expect(jobs).toHaveLength(names.length); // pressed twice: one job
    if (rate === 0.5) expect(jobs.some((j) => j.attempts > 1)).toBe(true); // failures really happened
    expect(jobs.filter((j) => j.status !== "done").map((j) => `${(j.payload as { name: string }).name}:${j.status}:${j.lastError}`)).toEqual([]);
    for (const name of names) expect(wa.createdTemplates.filter((t) => t.name === name), name).toHaveLength(1);
  });
});
