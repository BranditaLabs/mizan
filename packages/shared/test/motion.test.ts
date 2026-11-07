import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DOMAIN_EVENT_TYPES, DROP_ALLOWLIST, ENGINE_EVENT_TYPES, ENGINE_MOTION, EVENT_MOTION, ORDER_EVENT_TYPES, OUTCOMES, PENDINGS, SURFACES,
  TIMELINE_MOTION, engineMotion, motionFor, outcomesOf, type EventData,
} from "../src/index.js";
import * as catalogue from "../src/motion/index.js";
// @ts-expect-error -- a plain .mjs script without types
import { DART_PATH, renderDart } from "../scripts/gen-dart-motion.mjs";
// @ts-expect-error -- a plain .mjs script without types
import { DOCS_PATH, renderMotionTable, withTable } from "../scripts/gen-motion-docs.mjs";

const repo = new URL("../../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, repo), "utf8");
const messages = (app: "web" | "admin", loc: "en" | "ar") => JSON.parse(read(`apps/${app}/messages/${loc}.json`)) as Record<string, unknown>;
const at = (o: unknown, path: string): unknown => path.split(".").reduce<unknown>((n, k) => (n && typeof n === "object" ? (n as Record<string, unknown>)[k] : undefined), o);

describe("the event-motion catalogue: every event has one known meaning", () => {
  it("EVENT_MOTION covers every domain event, and nothing else", () => {
    expect(Object.keys(EVENT_MOTION).sort()).toEqual([...DOMAIN_EVENT_TYPES].sort());
  });

  it.each(Object.entries(EVENT_MOTION))("%s maps to a known outcome, pending loader and surfaces", (_type, rule) => {
    for (const { outcome } of outcomesOf(rule)) expect(OUTCOMES).toContain(outcome);
    if (rule.pending) expect(PENDINGS).toContain(rule.pending);
    for (const s of rule.surfaces) expect(SURFACES).toContain(s);
    expect(rule.audience).toBe("merchant");
    // A variant's "other" branch is the rule's own outcome, so tools that ignore variants still agree.
    if (rule.variant) expect(rule.variant.outcomes.other).toBe(rule.outcome);
    // Quiet without a variant says nothing; everything else has copy.
    expect(rule.copy === null).toBe(rule.outcome === "quiet" && !rule.variant);
  });

  it("red DROP only on the checked-in allowlist (an order confirmed or money in)", () => {
    const drops = Object.entries(EVENT_MOTION).flatMap(([type, rule]) => outcomesOf(rule).filter((o) => o.outcome === "drop").map((o) => (o.branch && o.branch !== "other" ? `${type}:${o.branch}` : type)));
    expect(drops.sort()).toEqual([...DROP_ALLOWLIST].sort());
  });

  it("money going out is never red", () => {
    expect(outcomesOf(EVENT_MOTION["refund.completed"]).map((o) => o.outcome)).toEqual(["done"]);
    expect(outcomesOf(EVENT_MOTION["refund.approved"]).map((o) => o.outcome)).not.toContain("drop");
  });

  it("each motion keeps its meaning: failures fail, warnings tip, reconciliations merge", () => {
    for (const [type, rule] of Object.entries(EVENT_MOTION)) {
      if (/failed$|_failed$|\.refused$|^shipment\.returned$|\.rejected$|\.error$/.test(type) && type !== "refund.rejected") expect(rule.outcome, type).toBe("fail");
      if (/reconciled$|\.matched$|recovered$/.test(type)) expect(rule.outcome, type).toBe("merge");
      if (/\.low$|\.out$|\.short$|_gap$|gap_found$|needs_review$|limit_reached$|sla_breached$|threshold_crossed$/.test(type)) expect(rule.outcome, type).toBe("tip");
    }
  });
});

describe("motionFor", () => {
  afterEach(() => vi.restoreAllMocks());
  // Recorded payload fixtures: the fields each emitter sends (file:line in apps/api/src).
  const fx: Record<string, [string, EventData, string, string]> = {
    // modules/orders/order-projector.ts:212 and modules/payments/ledger.service.ts:155
    "payment paid": ["order.payment_changed", { actor: { type: "engine" }, data: { number: "1001", mode: "cod", from: "unpaid", to: "paid", paidMinor: "115000", refundedMinor: "0", currency: "EGP" } }, "drop", "paid"],
    "payment failed": ["order.payment_changed", { actor: { type: "engine" }, data: { number: "1001", mode: "card", from: "unpaid", to: "failed", currency: "EGP" } }, "tip", "failed"],
    "payment refunded": ["order.payment_changed", { actor: { type: "user" }, data: { number: "1001", from: "paid", to: "refunded", currency: "EGP" } }, "settle", "refunded"],
    // modules/payments/disputes.service.ts:135
    "dispute won": ["dispute.closed", { actor: { type: "user" }, data: { disputeId: "d1", dispute: "D-7", outcome: "won", amountMinor: "5000", feeMinor: "0", currency: "EGP" } }, "drop", "won"],
    "dispute lost": ["dispute.closed", { data: { outcome: "lost" } }, "fail", "lost"],
    "dispute accepted": ["dispute.closed", { data: { outcome: "accepted" } }, "settle", "other"],
    // modules/profit/profit.service.ts:124
    "pnl final": ["pnl.recomputed", { actor: { type: "system" }, data: { number: "1001", currency: "EGP", netMinor: "12000", expectedNetMinor: "12000", isFinal: true, flags: [] } }, "merge", "final"],
    "pnl estimate": ["pnl.recomputed", { data: { isFinal: false } }, "quiet", "other"],
    // modules/purchasing/purchasing.service.ts:336
    "po full": ["po.received", { data: { number: "PO-3", receipt: "R-1", units: 40, damaged: 0, complete: true } }, "merge", "full"],
    "po partial": ["po.received", { data: { number: "PO-3", receipt: "R-1", units: 10, damaged: 0, complete: false } }, "done", "other"],
    // modules/orders/bulk.service.ts:120 (the bulk_actions counts)
    "bulk none failed": ["orders.bulk_finished", { data: { action: "tag", total: 10, done: 10, skipped: 0, failed: 0 } }, "done", "none"],
    "bulk some failed": ["orders.bulk_finished", { data: { action: "tag", total: 10, done: 7, skipped: 0, failed: 3 } }, "tip", "some"],
    "bulk all failed": ["orders.bulk_finished", { data: { action: "cancel", total: 4, done: 0, skipped: 0, failed: 4 } }, "fail", "all"],
    // modules/orders/order-projector.ts:177 (actor opts.actor ?? engine)
    "order manual": ["order.created", { actor: { type: "user" }, data: { number: "1002" } }, "drop", "manual"],
    "order ingested": ["order.created", { actor: { type: "engine" }, data: { number: "1003" } }, "settle", "other"],
    // integrations/connection-lifecycle.ts:55
    "disconnect by user": ["connection.disconnected", { actor: { type: "user" }, data: { provider: "shopify", reason: "user" } }, "settle", "byUser"],
    "disconnect by the store": ["connection.disconnected", { actor: null, data: { provider: "shopify", reason: "uninstalled" } }, "fail", "other"],
    // modules/stock/stock.service.ts:136 (items: variant → delta of the adjusted lines)
    "stock adjusted matched": ["stock.adjusted", { data: { items: {}, counted: ["v1"] } }, "merge", "matched"],
    "stock adjusted off": ["stock.adjusted", { data: { items: { v1: -2 }, counted: [] } }, "settle", "other"],
    // modules/privacy/privacy.service.ts:120 sends no due date today (settles); a dueAt in the past is overdue
    "privacy today": ["privacy.requested", { actor: null, data: { source: "shopify" } }, "settle", "other"],
    "privacy overdue": ["privacy.requested", { data: { source: "shopify", dueAt: "2026-01-01T00:00:00Z" }, now: Date.parse("2026-02-01T00:00:00Z") }, "tip", "overdue"],
  };

  it.each(Object.entries(fx))("%s", (_name, [type, data, outcome, branch]) => {
    const m = motionFor(type, data);
    expect(m.outcome).toBe(outcome);
    expect(m.select?.value).toBe(branch);
    expect(m.red).toBe(outcome === "drop");
    expect(m.copy).toBe(`motion.event.${type}`);
  });

  it("carries the pending loader, surfaces and merge key", () => {
    expect(motionFor("order.confirmed")).toMatchObject({ outcome: "drop", pending: "drop", red: true });
    expect(motionFor("connection.connected")).toMatchObject({ pending: "transfer", outcome: "merge" });
    expect(motionFor("shipment.status_changed").mergeKey).toBe("list");
  });

  it("an unknown type settles and warns once in development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(motionFor("nope.unknown")).toMatchObject({ outcome: "settle", unknown: true, copy: null });
    motionFor("nope.unknown");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toMatch(/data|phone|name/i);
  });
});

/** The `type` values apps/api writes to order_events (direct inserts, helpers and `offer_${status}`). */
function apiTimelineTypes(): Set<string> {
  const files: string[] = [];
  const walk = (dir: URL) => {
    for (const f of readdirSync(dir)) {
      const p = new URL(f, dir);
      if (statSync(p).isDirectory()) walk(new URL(`${f}/`, dir));
      else if (f.endsWith(".ts") && !/\.(test|spec)\.ts$/.test(f)) files.push(p.pathname.replace(/^\/([A-Za-z]:)/, "$1"));
    }
  };
  walk(new URL("apps/api/src/", repo));
  const found = new Set<string>();
  const offerStatuses = new Set<string>();
  for (const file of files) {
    const s = readFileSync(file, "utf8");
    if (!s.includes('insertInto("order_events")')) continue;
    for (const m of s.matchAll(/insertInto\("order_events"\)\.values\(/g)) {
      let depth = 1, j = m.index + m[0].length;
      while (depth && j < s.length) { const c = s[j++]; if ("([{".includes(c)) depth++; else if (")]}".includes(c)) depth--; }
      const body = s.slice(m.index + m[0].length, j);
      for (const t of body.matchAll(/(?<![\w])type:\s*"([a-z_]+)"/g)) found.add(t[1]);
      for (const t of body.matchAll(/(?<![\w])type:\s*\w+\s*\?\s*"([a-z_]+)"\s*:\s*"([a-z_]+)"/g)) { found.add(t[1]); found.add(t[2]); }
      if (/(?<![\w])type:\s*`offer_\$\{status\}`/.test(body)) {
        // offers.service.ts: the status is one of these literals right above the insert
        for (const st of s.matchAll(/"(accepted|declined|expired|applied|failed)"/g)) offerStatuses.add(st[1]);
      }
    }
    // Helpers whose type is a parameter: timeline(trx, t, id, "x" …), event("x" …), setOrderStatus(…, "from", "to", "x", …)
    for (const t of s.matchAll(/\b(?:this\.)?timeline\((?:[\w.]+,\s*){3}"([a-z_]+)"/g)) found.add(t[1]);
    for (const t of s.matchAll(/\bevent\("([a-z_]+)"/g)) found.add(t[1]);
    for (const t of s.matchAll(/setOrderStatus\([^)]*?"([a-z_]+)",\s*(?:actor|\{)/g)) found.add(t[1]);
  }
  for (const st of offerStatuses) found.add(`offer_${st}`);
  return found;
}

describe("TIMELINE_MOTION", () => {
  it("lists exactly the row types apps/api writes to order_events", () => {
    const api = apiTimelineTypes();
    expect([...api].filter((t) => !(ORDER_EVENT_TYPES as readonly string[]).includes(t)), "written by the API but not catalogued").toEqual([]);
    expect(ORDER_EVENT_TYPES.filter((t) => !api.has(t)), "catalogued but never written").toEqual([]);
  });

  it.each(Object.entries(TIMELINE_MOTION))("%s has a known outcome that agrees with its domain twin", (_type, rule) => {
    expect(OUTCOMES).toContain(rule.outcome);
    expect(rule.outcome).not.toBe("quiet");
    if (rule.twin) expect(outcomesOf(EVENT_MOTION[rule.twin]).map((o) => o.outcome)).toContain(rule.outcome);
  });

  it("only a confirmation or money in drops red", () => {
    expect(Object.entries(TIMELINE_MOTION).filter(([, r]) => r.outcome === "drop").map(([t]) => t).sort()).toEqual(["confirmed", "conversion_paid"]);
  });
});

describe("ENGINE_MOTION", () => {
  it("covers every engine event type, for staff surfaces only", () => {
    expect(Object.keys(ENGINE_MOTION).sort()).toEqual([...ENGINE_EVENT_TYPES].sort());
    for (const [type, rule] of Object.entries(ENGINE_MOTION)) {
      expect(rule.audience, type).toBe("staff");
      expect(OUTCOMES).toContain(rule.outcome);
      expect(rule.outcome, `${type}: the red belongs to the merchant twin`).not.toBe("drop");
      if ("twin" in rule && rule.twin) expect(DOMAIN_EVENT_TYPES).toContain(rule.twin);
    }
  });
  it("reads the access check's result", () => {
    expect(engineMotion("bosta.access_checked", { data: { ok: true } }).outcome).toBe("merge");
    expect(engineMotion("bosta.access_checked", { data: { ok: false, reason: "auth" } }).outcome).toBe("fail");
    expect(engineMotion("order.paid")).toEqual({ outcome: "quiet", twin: "order.payment_changed" });
  });
});

describe("copy (apps/web and apps/admin messages)", () => {
  const branches = (msg: string, arg: string) => {
    const m = new RegExp(`\\{${arg}, select, (.*)\\}$`, "s").exec(msg);
    return m ? [...m[1].matchAll(/(?:^|\}\s*)([A-Za-z_]+)\s*\{/g)].map((x) => x[1]) : [];
  };

  it.each(["en", "ar"] as const)("web %s has motion.event.<type> for every event with copy, with every variant branch", (loc) => {
    const msgs = messages("web", loc);
    for (const [type, rule] of Object.entries(EVENT_MOTION)) {
      if (!rule.copy) continue;
      const msg = at(msgs, rule.copy);
      expect(typeof msg, rule.copy).toBe("string");
      if (rule.variant) {
        const have = branches(msg as string, rule.variant.arg);
        for (const b of Object.keys(rule.variant.outcomes)) expect(have, `${rule.copy} branch ${b}`).toContain(b);
      }
    }
  });

  it.each(["en", "ar"] as const)("web %s has motion.timeline.<type> for every row type", (loc) => {
    const msgs = messages("web", loc);
    for (const rule of Object.values(TIMELINE_MOTION)) expect(typeof at(msgs, rule.copy), rule.copy).toBe("string");
  });

  it("no event type is a prefix of another, so the nested keys cannot collide", () => {
    for (const a of DOMAIN_EVENT_TYPES) for (const b of DOMAIN_EVENT_TYPES) if (a !== b) expect(b.startsWith(`${a}.`), `${a} / ${b}`).toBe(false);
  });

  const COMPONENT_KEYS = [
    "loader.loading", "loader.syncing", "loader.syncingWith", "loader.saving", "loader.sending", "loader.confirming", "loader.waitingReply", "loader.progress", "loader.percent", "boot",
    "gauge.title", "gauge.labelA", "gauge.labelB", "gauge.balanced", "gauge.shortBy", "gauge.overBy", "gauge.tilt", "gauge.summary",
    "vessels.title", "vessels.labelA", "vessels.labelB", "vessels.matched", "vessels.gap",
    "breakeven.title", "breakeven.axis", "breakeven.labelA", "breakeven.labelB", "breakeven.exact", "breakeven.profitable", "breakeven.below", "breakeven.noSpend",
    "bullseye.title", "bullseye.labelX", "bullseye.labelY", "bullseye.level", "bullseye.tolerance", "bullseye.off", "bullseye.offScale",
    "toast.dismiss", "batched",
  ];
  it.each([["web", "en"], ["web", "ar"], ["admin", "en"], ["admin", "ar"]] as const)("%s %s has every motion component key", (app, loc) => {
    const msgs = messages(app, loc);
    for (const k of COMPONENT_KEYS) expect(typeof at(msgs, `motion.${k}`), `motion.${k}`).toBe("string");
  });

  it("Arabic copy is Arabic, not a copy of the English", () => {
    const en = messages("web", "en"), ar = messages("web", "ar");
    for (const rule of Object.values(EVENT_MOTION)) if (rule.copy) expect(at(ar, rule.copy), rule.copy).not.toBe(at(en, rule.copy));
  });
});

describe("docs/13: the motion column", () => {
  const doc = () => readFileSync(DOCS_PATH, "utf8").replace(/\r\n/g, "\n");

  it("the Motion per event table is current (node packages/shared/scripts/gen-motion-docs.mjs)", () => {
    expect(doc()).toBe(withTable(doc(), renderMotionTable(catalogue)));
  });

  it("lists every domain event once, including the registry-only ones", () => {
    const rows = doc().split("\n").filter((l) => l.startsWith("| `")).map((l) => l.slice(3, l.indexOf("`", 3)));
    expect(rows.filter((r) => r in EVENT_MOTION).sort()).toEqual([...DOMAIN_EVENT_TYPES].sort());
    for (const type of ["settlement.matched", "settlement.gap_found"]) expect(rows, type).toContain(type);
  });
});

describe("the ops app's Dart catalogue", () => {
  it("apps/ops/lib/motion/event_motion.g.dart is current (node packages/shared/scripts/gen-dart-motion.mjs)", () => {
    const have = readFileSync(DART_PATH, "utf8").replace(/\r\n/g, "\n");
    expect(have).toBe(renderDart(catalogue));
  });
});
