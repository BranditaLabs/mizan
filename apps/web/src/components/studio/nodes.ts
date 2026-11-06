import type { IconProps } from "@mizan/design-system/icons/react";

/**
 * The studio's nodes: what the buyer can do in the chat, and the team's call. The catalogue's
 * groups decide where a key goes (one table), with the few keys of a shared group that answer
 * something else of their own (a message, an answer again, STOP/START).
 */
export type NodeId = "trigger" | "steps" | "confirms" | "offer" | "change" | "cancel" | "message" | "again" | "stop" | "every" | "team";
export type BranchId = Exclude<NodeId, "trigger" | "steps" | "team">;

export const GROUP_NODE: Record<string, NodeId> = {
  confirmation: "confirms", summary: "confirms", offer: "offer", change: "change", cancel: "cancel", system: "every", calls: "team",
};
const KEY_NODE: Record<string, NodeId> = { noted: "message", already: "again", opted_out: "stop", opted_in: "stop" };

export const nodeOf = (key: string, group: string): NodeId => KEY_NODE[key] ?? GROUP_NODE[group] ?? "every";

/** The branch grid under the WhatsApp step, in the order a buyer meets them. */
export const BRANCHES: ReadonlyArray<{ id: BranchId; icon: IconProps["name"] }> = [
  { id: "confirms", icon: "success" },
  { id: "change", icon: "edit" },
  { id: "cancel", icon: "error" },
  { id: "message", icon: "message" },
  { id: "again", icon: "refresh" },
  { id: "stop", icon: "notification" },
  { id: "every", icon: "settings" },
];

/** The keys of a node in catalogue order. */
export function keysOf<K extends { key: string; group: string }>(keys: readonly K[], node: NodeId): K[] {
  return keys.filter((k) => nodeOf(k.key, k.group) === node);
}

/** The bubble that opens a node first in the phone (for scrolling the chat to it). */
export const SCENARIO_OF: Partial<Record<NodeId, string>> = {
  confirms: "confirm", offer: "confirm_offer", change: "change", cancel: "cancel", message: "message", again: "already", stop: "opt_out",
};
