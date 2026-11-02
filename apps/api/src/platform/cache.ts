/** A small bounded LRU with per-entry expiry, for hot-path lookups that tolerate brief staleness. */
export class TtlCache<K, V> {
  private readonly map = new Map<K, { value: V; expires: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly max = 50_000,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: K): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires <= this.now()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key); // refresh LRU position
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: K, value: V): void {
    if (this.ttlMs <= 0) return;
    this.map.delete(key);
    this.map.set(key, { value, expires: this.now() + this.ttlMs });
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }

  delete(key: K): void {
    this.map.delete(key);
  }

  /** Remove every key matching a predicate (e.g. all memberships of one store). */
  deleteWhere(match: (key: K) => boolean): void {
    for (const k of [...this.map.keys()]) if (match(k)) this.map.delete(k);
  }

  get size(): number {
    return this.map.size;
  }
}
