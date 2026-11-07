/**
 * The mini connections map's geometry for the auth stage, per variant (island 440×300, band
 * 560×96, strip 358×56). The same hub-and-spokes shape as onboarding's connections map (docs/16 §6),
 * so the hand-off can morph one into the other. Pure numbers: the particles' keyframes are sampled
 * from the lanes once, at module load, so the stage build never computes curves on the main thread.
 */
export type NodeId = "shopify" | "woo" | "bosta" | "whatsapp" | "cod";
export type Variant = "island" | "band" | "strip";
export type Pt = { x: number; y: number };
export type MapNode = { id: NodeId; x: number; y: number; w: number; h: number; mono: string };
export type Geometry = { w: number; h: number; hub: Pt & { r: number }; nodes: MapNode[]; ghost: Pt & { w: number; h: number }; labels: boolean };

export const NODE_ORDER: NodeId[] = ["shopify", "woo", "whatsapp", "bosta", "cod"];
const MONO: Record<NodeId, string> = { shopify: "S", woo: "W", bosta: "B", whatsapp: "WA", cod: "$" };

export const GEOMETRY: Record<Variant, Geometry> = {
  island: {
    w: 440, h: 300, hub: { x: 220, y: 150, r: 36 }, labels: true,
    nodes: [
      { id: "shopify", x: 70, y: 52, w: 116, h: 38, mono: MONO.shopify },
      { id: "woo", x: 370, y: 52, w: 132, h: 38, mono: MONO.woo },
      { id: "whatsapp", x: 64, y: 248, w: 120, h: 38, mono: MONO.whatsapp },
      { id: "bosta", x: 376, y: 248, w: 104, h: 38, mono: MONO.bosta },
      { id: "cod", x: 220, y: 276, w: 88, h: 34, mono: MONO.cod },
    ],
    ghost: { x: 220, y: 42, w: 96, h: 34 },
  },
  band: {
    w: 560, h: 96, hub: { x: 280, y: 48, r: 26 }, labels: true,
    nodes: [
      { id: "shopify", x: 56, y: 26, w: 100, h: 30, mono: MONO.shopify },
      { id: "woo", x: 160, y: 74, w: 116, h: 30, mono: MONO.woo },
      { id: "whatsapp", x: 400, y: 74, w: 104, h: 30, mono: MONO.whatsapp },
      { id: "bosta", x: 504, y: 26, w: 92, h: 30, mono: MONO.bosta },
      { id: "cod", x: 400, y: 18, w: 70, h: 26, mono: MONO.cod },
    ],
    ghost: { x: 160, y: 20, w: 80, h: 26 },
  },
  strip: {
    w: 300, h: 56, hub: { x: 150, y: 28, r: 18 }, labels: false,
    nodes: [
      { id: "shopify", x: 26, y: 28, w: 32, h: 32, mono: MONO.shopify },
      { id: "woo", x: 84, y: 28, w: 32, h: 32, mono: MONO.woo },
      { id: "whatsapp", x: 216, y: 28, w: 32, h: 32, mono: MONO.whatsapp },
      { id: "bosta", x: 274, y: 28, w: 32, h: 32, mono: MONO.bosta },
    ],
    ghost: { x: 150, y: 6, w: 0, h: 0 },
  },
};

/** A lane from a node to the hub: a soft quadratic curve (control point bent toward the vertical centre). */
export function lane(g: Geometry, n: MapNode): { d: string; c: Pt; from: Pt; to: Pt } {
  const from = { x: n.x, y: n.y };
  const dx = g.hub.x - n.x;
  const dy = g.hub.y - n.y;
  const len = Math.hypot(dx, dy) || 1;
  const to = { x: g.hub.x - (dx / len) * (g.hub.r + 4), y: g.hub.y - (dy / len) * (g.hub.r + 4) };
  const c = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 + (n.y < g.hub.y ? 1 : -1) * Math.min(28, Math.abs(dx) * 0.18) };
  return { d: `M${from.x.toFixed(1)} ${from.y.toFixed(1)} Q${c.x.toFixed(1)} ${c.y.toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`, c, from, to };
}

/** 8 points along a lane (quadratic Bézier), the particle's keyframes. */
export function samples(from: Pt, c: Pt, to: Pt, count = 8): Pt[] {
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1);
    const u = 1 - t;
    return { x: u * u * from.x + 2 * u * t * c.x + t * t * to.x, y: u * u * from.y + 2 * u * t * c.y + t * t * to.y };
  });
}

/** Particle keyframes per variant and node, computed once. */
export const PARTICLES: Record<Variant, Record<string, Pt[]>> = Object.fromEntries(
  (Object.keys(GEOMETRY) as Variant[]).map((v) => {
    const g = GEOMETRY[v];
    return [v, Object.fromEntries(g.nodes.map((n) => { const l = lane(g, n); return [n.id, samples(l.from, l.c, l.to)]; }))];
  }),
) as Record<Variant, Record<string, Pt[]>>;
