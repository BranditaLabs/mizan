import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import ar from "../messages/ar.json";
import en from "../messages/en.json";
import { auditActionKey, auditActionLabel, auditActorLabel } from "../src/lib/audit";

type Tree = { [k: string]: string | Tree };
/** A tiny `useTranslations("auditLog")` over the real messages. */
function translator(messages: Tree) {
  const get = (key: string) => key.split(".").reduce<string | Tree | undefined>((n, k) => (n && typeof n === "object" ? n[k] : undefined), messages);
  const t = (key: string, values: Record<string, string> = {}) => {
    const v = get(key);
    if (typeof v !== "string") throw new Error(`missing ${key}`);
    return v.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "");
  };
  t.has = (key: string) => typeof get(key) === "string";
  return t;
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : f.endsWith(".ts") ? [p] : [];
  });
}

/** Every audit action the API records (`action: "family.verb"`). */
const API_ACTIONS = [...new Set(sources(join(__dirname, "..", "..", "api", "src"))
  .flatMap((f) => [...readFileSync(f, "utf8").matchAll(/action: (?:[^,}]*\? )?"([a-z_]+\.[a-z_.]+)"(?: : "([a-z_]+\.[a-z_.]+)")?/g)].flatMap((m) => [m[1]!, m[2]].filter(Boolean) as string[])))];

describe("audit action labels (FX-1: one key shape, a generic fallback)", () => {
  const tAr = translator((ar as Tree).auditLog as Tree);
  const tEn = translator((en as Tree).auditLog as Tree);

  it("finds the API's actions", () => expect(API_ACTIONS.length).toBeGreaterThan(50));

  it("every API action family has a name in both languages, so no raw code reaches the screen", () => {
    const families = [...new Set(API_ACTIONS.map((a) => a.split(".")[0]!))];
    const missing = families.filter((f) => !tAr.has(`families.${f}`) || !tEn.has(`families.${f}`));
    expect(missing).toEqual([]);
    for (const a of API_ACTIONS) {
      expect(auditActionLabel(tAr, a)).not.toContain(a);
      expect(auditActionLabel(tAr, a)).toMatch(/[؀-ۿ]/);
    }
  });

  it("uses the specific label first, then the family, then the store", () => {
    expect(auditActionKey("member.invited")).toBe("actions.member.invited");
    expect(auditActionKey("order.status.changed")).toBe("actions.order.status_changed");
    expect(auditActionLabel(tEn, "member.invited")).toBe(tEn("actions.member.invited"));
    expect(auditActionLabel(tEn, "po.landed_cost_added")).toBe("A change in Purchase orders");
    expect(auditActionLabel(tEn, "brand_new.thing")).toBe("A change in the store");
  });

  it("actors: never a raw type", () => {
    expect(auditActorLabel(tEn, { type: "webhook", displayName: null })).toBe(tEn("actor.system"));
    expect(auditActorLabel(tEn, { type: "user", displayName: null })).toBe(tEn("actor.someone"));
  });
});
