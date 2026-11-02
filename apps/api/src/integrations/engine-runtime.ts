import type { Runtime } from "@mizan/engine";
import type { ResolvedConnections } from "./connection-resolver.js";

/** Builds the engine runtime for a tenant (tests inject fake providers here). */
/** Runtime for a tenant's engine; also called without connections for one-off provider calls (OAuth code exchange). */
export type RuntimeFactory = (tenantId: string, connections?: ResolvedConnections) => Runtime;
export const ENGINE_RUNTIME = Symbol("ENGINE_RUNTIME");
