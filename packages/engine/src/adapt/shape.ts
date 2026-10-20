import { createHash } from "node:crypto";

/**
 * Response-shape fingerprinting.
 *
 * For each endpoint, the engine reduces a response to its structure
 * (key paths and value types, arrays collapsed) and hashes it. The first
 * shape seen becomes the baseline. When a later response has keys the
 * baseline lacks, or lacks keys the baseline had, that is reported as
 * `shape_changed` with the exact paths, often days before a field
 * disappears for good.
 */
export function shapeOf(value: unknown, prefix = "", out = new Map<string, string>(), depth = 0): Map<string, string> {
  if (depth > 8) return out;
  if (Array.isArray(value)) {
    out.set(prefix || "$", "array"); // the container; items live under "path[]" so empty → filled is an addition, not a retype
    for (const item of value.slice(0, 3)) shapeOf(item, `${prefix}[]`, out, depth + 1);
    return out;
  }
  if (value && typeof value === "object") {
    if (prefix) out.set(prefix, "object");
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      shapeOf(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
    }
    return out;
  }
  out.set(prefix || "$", value === null ? "null" : typeof value);
  return out;
}

export function fingerprint(shape: Map<string, string>): string {
  const lines = [...shape.entries()].filter(([, t]) => t !== "null").map(([k, t]) => `${k}:${t}`).sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 16);
}

export interface ShapeDiff {
  added: string[];
  removed: string[];
  retyped: string[];
}

export function diffShapes(baseline: Map<string, string>, current: Map<string, string>): ShapeDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const retyped: string[] = [];
  for (const [k, t] of current) {
    if (t === "null") continue;
    const b = baseline.get(k);
    if (b === undefined) added.push(k);
    else if (b !== t && b !== "null") retyped.push(`${k}: ${b} → ${t}`);
  }
  // An array that is empty in this response says nothing about its items' fields.
  const emptyArrays = [...current.entries()].filter(([k, t]) => t === "array" && !current.has(`${k === "$" ? "" : k}[]`)).map(([k]) => `${k === "$" ? "" : k}[]`);
  for (const [k, t] of baseline) {
    if (t === "null") continue;
    if (emptyArrays.some((a) => k === a || k.startsWith(`${a}.`) || k.startsWith(`${a}[]`))) continue;
    if (!current.has(k)) removed.push(k);
  }
  return { added, removed, retyped };
}

/** Keeps one baseline shape per endpoint and reports changes. */
export class ShapeWatch {
  private readonly baselines = new Map<string, Map<string, string>>();

  observe(endpoint: string, value: unknown): ShapeDiff | null {
    const cur = shapeOf(value);
    const base = this.baselines.get(endpoint);
    if (!base) {
      this.baselines.set(endpoint, cur);
      return null;
    }
    const d = diffShapes(base, cur);
    // Only removals and type changes are breaking; additions are noted but are usually safe.
    if (!d.added.length && !d.removed.length && !d.retyped.length) return null;
    for (const [k, t] of cur) if (!base.has(k)) base.set(k, t); // learn additive changes so they report once
    return d;
  }
}
