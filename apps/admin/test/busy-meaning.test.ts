import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WAIT_MOTION } from "@mizan/shared/motion";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// The back office shares the web app's busy-needs-meaning rule (its RuleTester cases live in
// apps/web/test/busy-meaning.test.ts); these check it is on here and that the screens follow it.
const src = fileURLToPath(new URL("../src", import.meta.url));
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : [p];
});
const read = (rel: string) => readFileSync(join(src, rel), "utf8");

describe("lint config", () => {
  const eslint = new ESLint({ cwd: fileURLToPath(new URL("..", import.meta.url)) });
  it("blocks a busy button with no meaning and a PrimaryCta with no busyAs", async () => {
    const [result] = await eslint.lintText(
      `import { Button } from "@/components/ui/Button";\nimport { PrimaryCta } from "@mizan/design-system/auth/react";\nexport function Bad({ p }: { p: boolean }) { return <><Button busy={p}>{"x"}</Button><PrimaryCta label="x" busy={p} /></>; }\n`,
      { filePath: "src/components/Bad.tsx" },
    );
    expect(result!.messages.filter((m) => m.ruleId === "mizan/busy-needs-meaning")).toHaveLength(2);
  });
});

describe("every busy names a meaning", () => {
  it("each <Button busy> in a screen carries as=", () => {
    const bad: string[] = [];
    for (const f of files(src).filter((x) => x.endsWith(".tsx") && !/components[\\/]ui[\\/]/.test(x))) {
      for (const m of readFileSync(f, "utf8").matchAll(/<(?:Button|IconButton)\b[^>]*?\sbusy=\{/gs)) {
        const s = readFileSync(f, "utf8");
        const tag = s.slice(m.index, s.indexOf(">", m.index + m[0].length + 1) + 1);
        if (!/\sas="/.test(tag)) bad.push(`${f.slice(src.length)}: ${tag.slice(0, 80)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("BusyLoader has no default loader", () => {
    expect(read("components/ui/BusyLabel.tsx")).not.toMatch(/pending\s*=\s*"drop"/);
  });
});

describe("staff sign-in: each press plays what it does", () => {
  const s = read("components/auth/SignIn.tsx");
  it("sign in pairs, then the MFA SMS transfers; the code check pairs; resend transfers on the link only", () => {
    expect(s).toMatch(/<PrimaryCta label=\{t\("signIn"\)\} busy=\{busy === "primary"\} busyAs=\{phase \?\? "signingIn"\}/);
    expect(s.indexOf('setPhase("sending")')).toBeLessThan(s.indexOf("await sendCode(resolver, hint)"));
    expect(s).toMatch(/<PrimaryCta label=\{t\("mfa.submit"\)\} busy=\{busy === "primary"\} busyAs="checking"/);
    expect(s).toMatch(/<ResendTimer[^>]*busy=\{busy === "resend"\}/);
    expect(s).toMatch(/\}, "resend"\);/);
    expect([WAIT_MOTION.signingIn, WAIT_MOTION.sending, WAIT_MOTION.checking]).toEqual(["pair", "transfer", "pair"]);
  });
  it("while the session is read it shows the PAIR, not the form", () => {
    const loading = s.indexOf('status === "loading"');
    expect(loading).toBeGreaterThan(0);
    expect(s.slice(loading, loading + 200)).toMatch(/<AuthProgress kind="loading"/);
    expect(loading).toBeLessThan(s.indexOf("<StepHost"));
  });
});

describe("first loads show PageState (a wait for an answer), not an empty list", () => {
  it.each([
    ["components/access/AccessScreen.tsx", "!q.data ? <PageState"],
    ["components/flags/FlagsScreen.tsx", "!q.data ? <PageState"],
    ["components/flags/AnnouncementsScreen.tsx", "!q.data ? <PageState"],
    ["components/staff/StaffScreen.tsx", "!q.data ? <PageState"],
    ["components/stores/StoresScreen.tsx", "!list.data ? <PageState"],
    ["components/users/UsersScreen.tsx", "!list.data ? <PageState"],
    ["components/users/UsersScreen.tsx", "detail.isPending ? <PageState"],
    ["components/stores/StoreSso.tsx", "<PageState"],
    ["components/staff/AuditScreen.tsx", "!q.data ? <PageState"],
    ["components/staff/AuditScreen.tsx", 'as="loading"'],
  ])("%s", (file, needle) => {
    expect(read(file)).toContain(needle);
  });
});
