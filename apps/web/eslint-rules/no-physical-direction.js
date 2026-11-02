/**
 * Mizan lint rule (docs/08 §3, CLAUDE.md rule 11): layouts use logical directions so the
 * same markup works in Arabic (RTL) and English (LTR). Flags physical Tailwind classes
 * (ml-4, pr-2, left-0, text-right, border-l, rounded-tr …, with any variant prefix) in
 * className / class attributes and in cn() / clsx() / cva() / twMerge() arguments.
 */
const LOGICAL = [
  [/^(-?)(scroll-)?m([lr])(-|$)/, (m) => `${m[1]}${m[2] ?? ""}m${m[3] === "l" ? "s" : "e"}${m[4]}`],
  [/^(scroll-)?p([lr])(-|$)/, (m) => `${m[1] ?? ""}p${m[2] === "l" ? "s" : "e"}${m[3]}`],
  [/^(-?)(left|right)(-)/, (m) => `${m[1]}${m[2] === "left" ? "start" : "end"}${m[3]}`],
  [/^border-([lr])(-|$)/, (m) => `border-${m[1] === "l" ? "s" : "e"}${m[2]}`],
  [/^rounded-([lr])(-|$)/, (m) => `rounded-${m[1] === "l" ? "s" : "e"}${m[2]}`],
  [/^rounded-(tl|tr|bl|br)(-|$)/, (m) => `rounded-${{ tl: "ss", tr: "se", bl: "es", br: "ee" }[m[1]]}${m[2]}`],
  [/^(text|float|clear)-(left|right)$/, (m) => `${m[1]}-${m[2] === "left" ? "start" : "end"}`],
];

const CALLEES = new Set(["cn", "clsx", "cva", "twMerge", "classNames"]);

/** "hover:-ml-2" → { base: "-ml-2", prefix: "hover:" }; "!" important markers are kept with the prefix. */
function split(token) {
  const i = token.lastIndexOf(":");
  const prefix = i >= 0 ? token.slice(0, i + 1) : "";
  let base = i >= 0 ? token.slice(i + 1) : token;
  const bang = base.startsWith("!") ? "!" : "";
  base = base.replace(/^!/, "");
  return { prefix: prefix + bang, base };
}

/** The logical replacement for a physical class, or null when the class is fine. */
export function logicalFor(token) {
  const { prefix, base } = split(token);
  for (const [re, to] of LOGICAL) {
    const m = re.exec(base);
    if (m) return prefix + to(m) + base.slice(m[0].length);
  }
  return null;
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "Use logical (start/end) Tailwind classes instead of left/right ones" },
    messages: { physical: "'{{cls}}' is a physical direction; use '{{fix}}' so the layout works in RTL and LTR." },
    schema: [],
  },
  create(context) {
    const check = (node, text) => {
      for (const cls of text.split(/\s+/).filter(Boolean)) {
        const fix = logicalFor(cls);
        if (fix) context.report({ node, messageId: "physical", data: { cls, fix } });
      }
    };
    const visit = (node) => {
      if (!node) return;
      if (node.type === "Literal" && typeof node.value === "string") check(node, node.value);
      else if (node.type === "TemplateLiteral") {
        node.quasis.forEach((q) => check(q, q.value.cooked ?? ""));
        node.expressions.forEach(visit);
      }
      else if (node.type === "JSXExpressionContainer") visit(node.expression);
      else if (node.type === "ConditionalExpression") { visit(node.consequent); visit(node.alternate); }
      else if (node.type === "LogicalExpression") { visit(node.left); visit(node.right); }
      else if (node.type === "ArrayExpression") node.elements.forEach(visit);
      else if (node.type === "ObjectExpression") node.properties.forEach((p) => p.type === "Property" && (p.key.type === "Literal" ? visit(p.key) : p.key.type === "Identifier" && check(p.key, p.key.name)));
      else if (node.type === "CallExpression") node.arguments.forEach(visit);
    };
    return {
      JSXAttribute(node) {
        if (node.name.name === "className" || node.name.name === "class") visit(node.value);
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && CALLEES.has(node.callee.name)) node.arguments.forEach(visit);
      },
    };
  },
};

export default rule;
