import type { DriftSink } from "./drift.js";

/**
 * Tolerant field resolution.
 *
 * Instead of `payload.shippingAddress.phone`, adapters ask for a field by a
 * ranked list of candidate paths:
 *
 *   r.str("phone", ["shippingAddress.phone", "customer.phone", "phone"])
 *
 * The first non-empty match wins. If the first candidate is missing but a
 * later one matches, the value is still returned and a `fallback_field`
 * drift event is recorded. Values with an unexpected type are coerced where
 * it is safe ("45" → 45, {code: 45} → 45) and recorded as `coerced_value`.
 * Only when nothing matches and the field is required does the adapter stop,
 * with a `schema_drift` error that names the field and the paths it tried.
 */

export type Path = string;

export function getPath(obj: unknown, path: Path): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur == null) return undefined;
    if (Array.isArray(cur) && /^\d+$/.test(part)) cur = cur[Number(part)];
    else if (typeof cur === "object") cur = (cur as Record<string, unknown>)[part];
    else return undefined;
  }
  return cur;
}

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

export class SchemaDriftError extends Error {
  constructor(readonly connector: string, readonly entity: string, readonly field: string, readonly tried: Path[]) {
    super(`${connector} ${entity}: required field "${field}" not found (tried ${tried.join(", ")})`);
    this.name = "SchemaDriftError";
  }
}

export class Resolver {
  constructor(
    private readonly source: unknown,
    private readonly ctx: { connector: string; entity: string; drift: DriftSink; now: () => number },
  ) {}

  /** Raw value from the first matching path. */
  any(field: string, paths: Path[], opts: { required?: boolean } = {}): unknown {
    for (let i = 0; i < paths.length; i++) {
      const v = getPath(this.source, paths[i]);
      if (!isEmpty(v)) {
        if (i > 0) {
          this.ctx.drift.record({
            connector: this.ctx.connector, entity: this.ctx.entity, kind: "fallback_field", field,
            detail: `"${paths[0]}" missing; used "${paths[i]}"`, at: this.ctx.now(),
          });
        }
        return v;
      }
    }
    if (opts.required) {
      this.ctx.drift.record({
        connector: this.ctx.connector, entity: this.ctx.entity, kind: "missing_field", field,
        detail: `none of ${paths.join(", ")}`, sample: trimSample(this.source), at: this.ctx.now(),
      });
      throw new SchemaDriftError(this.ctx.connector, this.ctx.entity, field, paths);
    }
    return undefined;
  }

  str(field: string, paths: Path[], opts: { required?: boolean } = {}): string | undefined {
    const v = this.any(field, paths, opts);
    if (v === undefined) return undefined;
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    // {value: "..."} / {label: "..."} wrappers seen when providers move to objects
    const inner = unwrap(v, ["value", "amount", "label", "name", "code", "id"]);
    if (inner !== undefined) {
      this.coerced(field, v);
      return String(inner);
    }
    this.coerced(field, v);
    return JSON.stringify(v);
  }

  num(field: string, paths: Path[], opts: { required?: boolean } = {}): number | undefined {
    const v = this.any(field, paths, opts);
    if (v === undefined) return undefined;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const raw = typeof v === "object" ? unwrap(v, ["code", "value", "amount"]) : v;
    const n = typeof raw === "number" ? raw : Number(String(raw ?? "").replace(/[, ]/g, ""));
    if (Number.isFinite(n)) {
      this.coerced(field, v);
      return n;
    }
    if (opts.required) throw new SchemaDriftError(this.ctx.connector, this.ctx.entity, field, paths);
    return undefined;
  }

  bool(field: string, paths: Path[]): boolean | undefined {
    const v = this.any(field, paths);
    if (v === undefined) return undefined;
    if (typeof v === "boolean") return v;
    this.coerced(field, v);
    return ["true", "1", "yes"].includes(String(v).toLowerCase());
  }

  arr<T = unknown>(field: string, paths: Path[]): T[] {
    const v = this.any(field, paths);
    if (v === undefined) return [];
    if (Array.isArray(v)) return v as T[];
    // GraphQL connections: { edges: [{ node }] } or { nodes: [...] }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (Array.isArray(o.nodes)) return o.nodes as T[];
      if (Array.isArray(o.edges)) return (o.edges as Array<{ node: T }>).map((e) => e.node);
    }
    this.coerced(field, v);
    return [v as T];
  }

  /** Resolver scoped to a nested object, sharing the same drift context. */
  child(source: unknown, entity = this.ctx.entity): Resolver {
    return new Resolver(source, { ...this.ctx, entity });
  }

  private coerced(field: string, v: unknown) {
    this.ctx.drift.record({
      connector: this.ctx.connector, entity: this.ctx.entity, kind: "coerced_value", field,
      detail: `unexpected ${Array.isArray(v) ? "array" : typeof v}`, sample: trimSample(v), at: this.ctx.now(),
    });
  }
}

function unwrap(v: unknown, keys: string[]): unknown {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  for (const k of keys) if (!isEmpty(o[k]) && typeof o[k] !== "object") return o[k];
  return undefined;
}

export function trimSample(v: unknown, max = 2_000): unknown {
  try {
    const s = JSON.stringify(v);
    return s && s.length > max ? s.slice(0, max) + "…" : v;
  } catch {
    return String(v);
  }
}
