import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WAIT_MOTION } from "@mizan/shared/motion";
import { ESLint, RuleTester } from "eslint";
import { describe, expect, it } from "vitest";
import busyRule, { silentWrite } from "../eslint-rules/busy-needs-meaning.js";
import { busyLoaderKind } from "../src/components/ui/BusyLabel";

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({ languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } });

tester.run("busy-needs-meaning", busyRule, {
  valid: [
    `<Button busy={save.isPending} as="saving">x</Button>`,
    `<Button busy={{ isPending: a.isPending, motion: "order.confirmed" }}>x</Button>`,
    `const ship = useEventMutation("shipment.created", {}); <Button busy={ship}>x</Button>`,
    `<IconButton icon="delete" label="x" busy={remove.isPending} as="saving" />`,
    `<ConfirmDialog busy={close.isPending} as="saving" />`,
    `<PrimaryCta busy={busy === "primary"} busyAs="signingIn" label="x" />`,
    `<PrimaryCta label="x" />`,
    `<MizanLoader kind="fill" value={0.3} valueText="30%" />`,
    { code: `<BusyLoader pending="pair" />; <Button pending="drop" busy as="saving" />`, filename: "src/components/ui/Button.tsx" },
    `<Button busy={false}>x</Button>`,
  ],
  invalid: [
    { code: `<Button busy={save.isPending}>x</Button>`, errors: [{ messageId: "busy" }] },
    { code: `<Button busy>x</Button>`, errors: [{ messageId: "busy" }] },
    { code: `<IconButton icon="delete" label="x" busy={remove.isPending} />`, errors: [{ messageId: "busy" }] },
    { code: `<ConfirmDialog busy={close.isPending} />`, errors: [{ messageId: "busy" }] },
    { code: `const m = useMutation({}); <Button busy={m}>x</Button>`, errors: [{ messageId: "busy" }] },
    { code: `<PrimaryCta busy={busy} label="x" />`, errors: [{ messageId: "cta" }] },
    { code: `<MizanLoader kind="fill" decorative />`, errors: [{ messageId: "fill" }] },
    { code: `<Button busy={x} as="saving" pending="fill">x</Button>`, filename: "src/components/catalog/Products.tsx", errors: [{ messageId: "pending" }] },
  ],
});

tester.run("silent-write", silentWrite, {
  valid: [
    `<Switch label="x" disabled={save.isPending} busy={save.isPending} as="saving" />`,
    `<Switch label="x" disabled={!q.data} />`,
  ],
  invalid: [
    { code: `<Switch label="x" disabled={toggle.isPending} />`, errors: [{ messageId: "silent" }] },
    { code: `<select disabled={!q.data || save.isPending} />`, errors: [{ messageId: "silent" }] },
    { code: `<IconButton icon="delete" label="x" disabled={remove.isPending} />`, errors: [{ messageId: "silent" }] },
  ],
});

describe("busy loaders follow the meaning, never a default", () => {
  it("a named meaning wins, an event with an action gives its loader, neither gives none", () => {
    expect(busyLoaderKind("signingIn", undefined)).toBe("pair");
    expect(busyLoaderKind("checking", undefined)).toBe("pair");
    expect(busyLoaderKind("sending", "order.confirmed")).toBe("transfer");
    expect(busyLoaderKind("creating", undefined)).toBe("drop");
    expect(busyLoaderKind(undefined, "connection.connected")).toBe("transfer");
    expect(busyLoaderKind(undefined, "order.confirmed")).toBe("drop");
    const warn = console.warn;
    console.warn = () => undefined;
    try {
      expect(busyLoaderKind(undefined, "shipment.delivered")).toBeUndefined();
      expect(busyLoaderKind(undefined, undefined)).toBeUndefined();
    } finally { console.warn = warn; }
  });
});

const src = fileURLToPath(new URL("../src", import.meta.url));
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : [p];
});

/**
 * The whole opening tag that starts at `start` (`<Button …>`): the first `>` outside braces and
 * quotes, so an arrow prop (`onClick={() => …}`) or a `>` in an expression never cuts it short.
 */
function openingTag(s: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start + 1; i < s.length; i++) {
    const c = s[i]!;
    if (quote) { if (c === quote && s[i - 1] !== "\\") quote = null; continue; }
    if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return s.slice(start, i + 1);
  }
  return s.slice(start);
}

/** The value of `busy={…}` in a tag, braces matched (`busy={{ isPending, motion }}` included). */
function busyExpr(tag: string): string | null {
  const at = tag.search(/\sbusy=\{/);
  if (at < 0) return null;
  const open = tag.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < tag.length; i++) {
    if (tag[i] === "{") depth++;
    else if (tag[i] === "}" && --depth === 0) return tag.slice(open + 1, i).trim();
  }
  return tag.slice(open + 1).trim();
}

describe("repo scan: every busy names a meaning", () => {
  const tsx = files(src).filter((f) => f.endsWith(".tsx"));
  it("every <Button|IconButton|ConfirmDialog busy={…}> carries as= or an event object/mutation", () => {
    const bad: string[] = [];
    for (const f of tsx) {
      const s = readFileSync(f, "utf8");
      const events = new Set([...s.matchAll(/const (\w+) = useEventMutation\(/g)].map((m) => m[1]));
      for (const m of s.matchAll(/<(?:Button|IconButton|ConfirmDialog)\b/g)) {
        const tag = openingTag(s, m.index);
        const expr = busyExpr(tag);
        if (expr === null || /\sas="/.test(tag) || expr.startsWith("{") || events.has(expr)) continue;
        bad.push(`${f.slice(src.length)}: busy={${expr}}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the scan reads a whole tag: a busy after an arrow prop is still checked", () => {
    const s = `<IconButton label="x" onClick={() => remove.mutate(id)} busy={remove.isPending} />`;
    const tag = openingTag(s, 0);
    expect(tag).toBe(s);
    expect(busyExpr(tag)).toBe("remove.isPending");
    expect(/\sas="/.test(tag)).toBe(false);
    expect(busyExpr(openingTag(`<Button busy={{ isPending: p, motion: "order.confirmed" }} onClick={() => go()}>`, 0))).toBe(`{ isPending: p, motion: "order.confirmed" }`);
  });

  it("no border-spin spinner in any CSS module (a hand-made wait; use Waiting)", () => {
    const css = files(src).filter((f) => f.endsWith(".css"));
    expect(css.filter((f) => /@keyframes\s+spin\b|rotate\(360deg\)/.test(readFileSync(f, "utf8")))).toEqual([]);
  });

  it("no screen passes pending= to a Button (only components/ui pass a loader)", () => {
    const bad = tsx.filter((f) => !/components[\\/]ui[\\/]/.test(f) && /<(?:Button|IconButton)\b[^>]*\spending=/s.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});

describe("auth: each press plays what it does (the owner's complaint)", () => {
  const signIn = readFileSync(join(src, "components/auth/SignIn.tsx"), "utf8");
  const twoStep = readFileSync(join(src, "components/auth/TwoStep.tsx"), "utf8");
  const ctas = [...signIn.matchAll(/\{cta\(([^\n]+)\)\}/g)].map((m) => m[1]!);
  const meaningOf = (needle: string) => {
    const call = ctas.find((c) => c.includes(needle));
    if (!call) return null;
    if (call.includes('creating ? "creating" : "signingIn"')) return "creating|signingIn";
    return /"(signingIn|checking|sending|creating|saving|loading)"\s*\)?$/.exec(call.trim())?.[1] ?? null;
  };
  it("every cta names its meaning; none is a default", () => {
    expect(ctas.length).toBeGreaterThanOrEqual(5);
    for (const c of ctas) expect(c, c).toMatch(/"(signingIn|checking|sending|creating|saving)"/);
    expect(signIn).not.toMatch(/busyAs:\s*"[a-zA-Z]+"\s*=/);
  });
  it("email sign-in pairs, create drops, phone transfers, code pairs, reset transfers, SSO pairs", () => {
    expect(meaningOf('creating ? t("createSubmit")')).toBe("creating|signingIn");
    expect(WAIT_MOTION.creating).toBe("drop");
    expect(WAIT_MOTION.signingIn).toBe("pair");
    expect(ctas).toContain('t("continue"), undefined, "sending"'); // phone: the SMS code goes out
    expect(meaningOf('"confirm"')).toBe("checking");
    expect(meaningOf('t("resetSend")')).toBe("sending");
    expect(meaningOf('t("ssoSubmit")')).toBe("signingIn");
    // The second step's SMS and the company window are sent out: the press turns to TRANSFER midway.
    expect(signIn.match(/setPhase\("sending"\)/g)?.length).toBe(2);
  });
  it("Google and resend animate only their own control", () => {
    expect(signIn).toMatch(/busy === "google" \? <AuthProgress/);
    expect(signIn).toMatch(/busy=\{busy === "resend"\}/);
    expect(signIn).toMatch(/run\(sendReset, null, "resend"\)/);
    expect(signIn).toMatch(/busy=\{busy === "primary"\}/);
  });
  it("a slow route after DoneState waits with the pair", () => {
    expect(signIn).toMatch(/slow \? <span className="mz-auth-slow"[^>]*><AuthProgress kind="loading"/);
  });
  it("two-step: send email transfers, I confirmed pairs, SMS transfers, enable drops, then DoneState", () => {
    expect(twoStep).toMatch(/busy=\{busy === "send"\} as="sending"/);
    expect(twoStep).toMatch(/busy=\{busy === "check"\} as="checking"/);
    expect(twoStep).toMatch(/busy=\{busy === "sms"\} as="sending"/);
    expect(twoStep).toMatch(/busy=\{busy === "enable"\} as="creating"/);
    expect(twoStep.indexOf("setEnabledNow(true)")).toBeLessThan(twoStep.indexOf("await signOutAndBack(true)"));
    expect(twoStep).toMatch(/<AuthProgress kind="confirmed" label=\{t\("enabledTitle"\)\}/);
  });
});

describe("lint config", () => {
  const eslint = new ESLint({ cwd: fileURLToPath(new URL("..", import.meta.url)) });
  it("blocks a busy button with no meaning", async () => {
    const [result] = await eslint.lintText(
      `import { Button } from "@/components/ui/Button";\nexport function Bad({ p }: { p: boolean }) { return <Button busy={p}>{"x"}</Button>; }\n`,
      { filePath: "src/components/Bad.tsx" },
    );
    expect(result!.messages.map((m) => m.ruleId)).toContain("mizan/busy-needs-meaning");
  });
});
