import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { MEMBER_ROLES, PERMISSIONS, SERVICE_CHECKED, type Permission } from "@mizan/shared";
import { describe, expect, it } from "vitest";

/**
 * Every role a store can invite must be able to do something its own (the audit found
 * media_buyer could be invited but no route named it). Routes without @Roles are open to every
 * member; this checks that each role is named on at least one restricted route.
 */
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".controller.ts") ? [p] : [];
  });
}

describe("roles", () => {
  it("every member role is named on at least one route", () => {
    const named = new Set<string>();
    for (const f of files(join(import.meta.dirname, "../src"))) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/@Roles\(([^)]*)\)/g)) for (const r of m[1]!.matchAll(/"([a-z_]+)"/g)) named.add(r[1]!);
      for (const m of src.matchAll(/@Can\("([a-z.]+)"\)/g)) for (const r of PERMISSIONS[m[1] as Permission]) named.add(r);
    }
    expect(MEMBER_ROLES.filter((r) => !named.has(r))).toEqual([]);
  });

  it("routes name a permission (U6), never a hand-written list of roles; every permission is used", () => {
    const used = new Set<string>();
    const raw: string[] = [];
    for (const f of files(join(import.meta.dirname, "../src"))) {
      const src = readFileSync(f, "utf8");
      if (/@Roles\(/.test(src)) raw.push(f);
      for (const m of src.matchAll(/@Can\("([a-z.]+)"\)/g)) used.add(m[1]!);
    }
    expect(raw).toEqual([]);
    expect(Object.keys(PERMISSIONS).filter((p) => !used.has(p) && !SERVICE_CHECKED.includes(p as Permission))).toEqual([]);
  });
});
