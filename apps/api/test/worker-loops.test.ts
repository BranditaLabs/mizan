import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The worker starts the background loops by name (it runs with WORKER_IN_PROCESS off). A loop that only
 * starts itself in the API process in development (runsWorkerInProcess) and is missing from worker.ts never
 * runs in production: the sync guardian shipped like that. Every such class must be started by the worker.
 */
const src = fileURLToPath(new URL("../src", import.meta.url));
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
});

describe("background loops", () => {
  it("every loop that runs in the worker is started by worker.ts", () => {
    const worker = readFileSync(join(src, "worker.ts"), "utf8");
    const loops = files(src).flatMap((f) => {
      const s = readFileSync(f, "utf8");
      if (!s.includes("onApplicationBootstrap()") || !s.includes("runsWorkerInProcess(")) return [];
      return [...s.matchAll(/export class (\w+)/g)].map((m) => m[1]!);
    });
    expect(loops.length).toBeGreaterThan(5);
    expect(loops.filter((name) => !worker.includes(`app.get(${name}).start()`))).toEqual([]);
  });
});
