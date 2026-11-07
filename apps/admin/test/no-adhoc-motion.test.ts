import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The back office shares the web app's lint rules (eslint.config.mjs); ESLint does not read CSS,
// so this is the admin side of the @keyframes guard (apps/web/test/no-adhoc-motion.test.ts).
const src = fileURLToPath(new URL("../src", import.meta.url));
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : [p];
});

describe("ad-hoc motion in admin CSS", () => {
  it("has no @keyframes or animation shorthand outside the design system", () => {
    const css = files(src).filter((f) => f.endsWith(".css"));
    expect(css.length).toBeGreaterThan(0);
    expect(css.filter((f) => /@keyframes\b|(?:^|[;{\s])animation(?:-name)?\s*:/m.test(readFileSync(f, "utf8")))).toEqual([]);
  });
});
