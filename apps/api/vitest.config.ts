import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// SWC emits decorator metadata, which NestJS dependency injection needs.
export default defineConfig({
  plugins: [swc.vite({ module: { type: "es6" } })],
  resolve: { conditions: ["source"] },
  // Boot hooks build the app and apply every migration to PGlite (~10 s on a slow machine).
  test: { testTimeout: 20_000, hookTimeout: 60_000 },
});
