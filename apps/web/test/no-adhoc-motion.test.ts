import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint, RuleTester } from "eslint";
import { describe, expect, it } from "vitest";
import motionRule, { bannedClass } from "../eslint-rules/no-adhoc-motion.js";
import redRule, { brandRed } from "../eslint-rules/no-brand-red.js";

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({ languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } });

describe("bannedClass / brandRed", () => {
  it.each(["animate-spin", "md:animate-ping", "animate-pulse", "mz-shimmer", "ld-scale", "ld-bars"])("%s is ad-hoc motion", (c) => expect(bannedClass(`flex ${c}`)).toBe(c));
  it.each(["mz-settle-in", "animate-none", "transition-colors", "mz-stagger", "bold-text"])("%s is fine", (c) => expect(bannedClass(c)).toBeNull());
  it.each(["#DE0000", "#e33232", "var(--mz-red)", "var(--mz-red-ink)", "text-red-600", "hover:bg-red-500", "fill-red"])("%s paints the brand red", (c) => expect(brandRed(c)).not.toBeNull());
  it.each(["text-danger-text", "bg-danger", "#B00000", "var(--mz-danger)", "text-brand-ink"])("%s is not the budgeted red", (c) => expect(brandRed(c)).toBeNull());
});

tester.run("no-adhoc-motion", motionRule, {
  valid: [
    `<MizanLoader kind="pair" decorative />`,
    `useMutation({ onSuccess: () => toast.event({ type: "order.confirmed" }) })`,
    `useMutation({ onError: () => toast({ message: "x" }) })`,
    `copy(() => toast({ message: "copied" }))`,
    { code: `el.animate([{ opacity: 0 }, { opacity: 1 }], 200)`, filename: "src/components/RouteMotion.tsx" },
  ],
  invalid: [
    { code: `<span className="size-3 animate-spin rounded-full" />`, errors: [{ messageId: "cls" }] },
    { code: "<i className={`absolute ${x ? 'animate-ping' : ''}`} />", errors: [{ messageId: "cls" }] },
    { code: `<div className="ld-rail" />`, errors: [{ messageId: "cls" }] },
    { code: `part.animate([{ transform: "scaleX(0)" }], { duration: 520 })`, filename: "src/components/home/ProfitHome.tsx", errors: [{ messageId: "animate" }] },
    { code: `import { ScaleLoader, LedgerBars } from "@/components/ui/Loader";`, errors: 2 },
    { code: `<mizan-loader type="pair" />`, errors: [{ messageId: "element" }] },
    { code: `<mz-gauge a="1" />`, errors: [{ messageId: "element" }] },
    { code: `useMutation({ onSuccess: (r) => { toast({ message: t("saved") }); } })`, errors: [{ messageId: "toast" }] },
  ],
});

tester.run("no-brand-red", redRule, {
  valid: [`<p className="text-danger-text" />`, `const tone = "danger";`],
  invalid: [
    { code: `<span style={{ background: "#DE0000" }} />`, errors: [{ messageId: "red" }] },
    { code: `<span className="bg-red-500" />`, errors: [{ messageId: "red" }] },
    { code: "const f = `var(--mz-red)`;", errors: [{ messageId: "red" }] },
  ],
});

const src = fileURLToPath(new URL("../src", import.meta.url));
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : [p];
});

describe("ad-hoc motion in app CSS (ESLint does not read CSS)", () => {
  // Allow-listed: the landing page until its redesign, and the WhatsApp phone preview, which draws
  // WhatsApp's own interface (its typing dots and send spinner), not Mizan's.
  const ALLOWED = /(?:landing[\\/]landing\.css|studio[\\/]WhatsAppPhone\.module\.css)$/;
  it("has no @keyframes outside the design system", () => {
    const css = files(src).filter((f) => f.endsWith(".css") && !ALLOWED.test(f));
    expect(css.length).toBeGreaterThan(0);
    expect(css.filter((f) => /@keyframes\b/.test(readFileSync(f, "utf8")))).toEqual([]);
  });
});

describe("lint config", () => {
  const eslint = new ESLint({ cwd: fileURLToPath(new URL("..", import.meta.url)) });
  it("blocks a hand-made spinner and a success toast that picks its own motion", async () => {
    const [result] = await eslint.lintText(
      `import { useMutation } from "@tanstack/react-query";\nexport function Bad({ toast }: { toast(x: object): void }) { useMutation({ mutationFn: async () => 1, onSuccess: () => toast({ message: "x" }) }); return <span aria-hidden="true" className="size-3 animate-spin" />; }\n`,
      { filePath: "src/components/Bad.tsx" },
    );
    const rules = result!.messages.map((m) => m.ruleId);
    expect(rules.filter((r) => r === "mizan/no-adhoc-motion")).toHaveLength(2);
  });
});
