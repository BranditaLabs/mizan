// next build against the end-to-end stack (e2e/env.mjs).
import { spawnSync } from "node:child_process";
import { adminEnv } from "./env.mjs";

const r = spawnSync("npx", ["next", "build"], { stdio: "inherit", env: { ...process.env, ...adminEnv } });
process.exit(r.status ?? 1);
