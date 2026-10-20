import { ESLint, RuleTester } from "eslint";
import { describe, expect, it } from "vitest";
import rule, { logicalFor } from "../eslint-rules/no-physical-direction.js";

RuleTester.describe = describe;
RuleTester.it = it;
const tester = new RuleTester({ languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } } });

describe("logicalFor", () => {
  it.each([
    ["ml-4", "ms-4"], ["mr-auto", "me-auto"], ["-ml-2", "-ms-2"], ["pl-3", "ps-3"], ["pr-[11px]", "pe-[11px]"],
    ["left-0", "start-0"], ["-right-3", "-end-3"], ["border-l", "border-s"], ["border-r-2", "border-e-2"],
    ["rounded-l-lg", "rounded-s-lg"], ["rounded-tr", "rounded-se"], ["text-left", "text-start"], ["float-right", "float-end"],
    ["hover:ml-2", "hover:ms-2"], ["lg:!pr-4", "lg:!pe-4"], ["scroll-ml-4", "scroll-ms-4"],
  ])("%s → %s", (physical, logical) => expect(logicalFor(physical)).toBe(logical));

  it.each(["ms-4", "pe-2", "start-0", "mx-auto", "px-6", "inset-x-0", "text-start", "border-line", "rounded-lg", "left", "translate-x-1", "space-x-2"])(
    "%s is fine", (cls) => expect(logicalFor(cls)).toBeNull());
});

tester.run("no-physical-direction", rule, {
  valid: [
    `<div className="ms-4 pe-2 text-start" />`,
    `<div className={cn("ps-3", active && "border-s")} />`,
    `const left = "ml-4"; // plain strings outside class lists are not checked`,
  ],
  invalid: [
    { code: `<div className="flex ml-4" />`, errors: [{ messageId: "physical", data: { cls: "ml-4", fix: "ms-4" } }] },
    { code: "<div className={`p-2 ${x ? 'text-right' : 'pl-2'}`} />", errors: 2 },
    { code: `<div className={active ? "border-l" : "rounded-tr"} />`, errors: 2 },
    { code: `cn("lg:pr-4", { "left-0": open })`, errors: 2 },
  ],
});

describe("lint config", () => {
  const eslint = new ESLint({ cwd: new URL("..", import.meta.url).pathname });

  it("blocks physical direction classes and literal UI strings in components", async () => {
    const [result] = await eslint.lintText(
      `export function Bad() { return <p className="ml-4 text-right">Orders</p>; }\n`,
      { filePath: "src/components/Bad.tsx" },
    );
    const rules = result!.messages.map((m) => m.ruleId);
    expect(rules.filter((r) => r === "mizan/no-physical-direction")).toHaveLength(2);
    expect(rules).toContain("react/jsx-no-literals");
  });

  it("accepts the logical, translated version", async () => {
    const [result] = await eslint.lintText(
      `import { useTranslations } from "next-intl";\nexport function Good() { const t = useTranslations("shell"); return <p className="ms-4 text-end">{t("brand")}</p>; }\n`,
      { filePath: "src/components/Good.tsx" },
    );
    expect(result!.messages.filter((m) => m.severity === 2)).toEqual([]);
  });
});
