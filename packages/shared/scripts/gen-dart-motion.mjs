/**
 * Writes apps/ops/lib/motion/event_motion.g.dart from the event-motion catalogue
 * (packages/shared/src/motion), so the ops app plays the same outcome for the same event.
 *   npm run build -w @mizan/shared && node packages/shared/scripts/gen-dart-motion.mjs
 * test/motion.test.ts fails when the committed file is not current.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DART_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../../apps/ops/lib/motion/event_motion.g.dart");

const q = (s) => `'${String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\$/g, "\\$")}'`;

/** The Dart source for the three catalogues. Pure: the test calls it with the TypeScript catalogue. */
export function renderDart({ EVENT_MOTION, TIMELINE_MOTION, ENGINE_MOTION, OUTCOMES, PENDINGS, ACTIONS }) {
  const outcome = (o) => `MotionOutcome.${o}`;
  const events = Object.entries(EVENT_MOTION).map(([type, r]) => {
    const parts = [`outcome: ${outcome(r.outcome)}`];
    if (r.action) parts.push(`action: MotionAction.${r.action === "sync" ? "sync_" : r.action}`);
    if (r.pending) parts.push(`pending: MotionPending.${r.pending}`);
    parts.push(`surfaces: <String>[${r.surfaces.map(q).join(", ")}]`);
    parts.push(`copy: ${r.copy ? q(r.copy) : "null"}`);
    if (r.variant) parts.push(`variantArg: ${q(r.variant.arg)}`, `variants: <String, MotionOutcome>{${Object.entries(r.variant.outcomes).map(([b, o]) => `${q(b)}: ${outcome(o)}`).join(", ")}}`);
    return `  ${q(type)}: EventMotion(${parts.join(", ")}),`;
  });
  const timeline = Object.entries(TIMELINE_MOTION).map(([type, r]) => `  ${q(type)}: ${outcome(r.outcome)},`);
  const engine = Object.entries(ENGINE_MOTION).map(([type, r]) => `  ${q(type)}: ${outcome(r.outcome)},`);
  return `// Generated from packages/shared/src/motion by packages/shared/scripts/gen-dart-motion.mjs. Do not edit.
// The event-motion catalogue: what each event plays (Brand 2.0 motion rules), shared with the web app.

enum MotionOutcome { ${OUTCOMES.join(", ")} }

enum MotionPending { ${PENDINGS.join(", ")} }

/// What the viewer's action does; the loader is derived from it (read = pair, send/sync = transfer, write = drop, progress = fill).
enum MotionAction { ${ACTIONS.map((a) => (a === "sync" ? "sync_" : a)).join(", ")} }

class EventMotion {
  const EventMotion({required this.outcome, this.action, this.pending, required this.surfaces, required this.copy, this.variantArg, this.variants});

  final MotionOutcome outcome;
  final MotionAction? action;
  final MotionPending? pending;
  final List<String> surfaces;

  /// The ARB/next-intl key, or null for a quiet event.
  final String? copy;

  /// The ICU select argument and its branches (an event whose outcome depends on a non-PII field).
  final String? variantArg;
  final Map<String, MotionOutcome>? variants;

  /// The outcome for a variant branch ("other" when the branch is unknown).
  MotionOutcome outcomeFor(String? branch) => variants == null ? outcome : (variants![branch] ?? variants!['other'] ?? outcome);
}

const Map<String, EventMotion> eventMotion = <String, EventMotion>{
${events.join("\n")}
};

const Map<String, MotionOutcome> timelineMotion = <String, MotionOutcome>{
${timeline.join("\n")}
};

const Map<String, MotionOutcome> engineMotion = <String, MotionOutcome>{
${engine.join("\n")}
};
`;
}

if (process.argv[1]?.endsWith("gen-dart-motion.mjs")) {
  const m = await import("../dist/motion/index.js");
  mkdirSync(dirname(DART_PATH), { recursive: true });
  writeFileSync(DART_PATH, renderDart(m));
  console.log(`wrote ${DART_PATH}`);
}
