/**
 * mizan/no-brand-red (Brand 2.0): red appears once per view, and only the design system's motion
 * components hand it out (the red budget: a DROP, a balanced verdict, the page loader, RedSwatch).
 * App code never paints the brand red itself: no #DE0000 / #E33232 (or the dark theme's #EA4643),
 * none of the red's token names (--mz-red, --mz-red-ink, --mz-brand, --mz-brand-red,
 * --mz-brand-red-hi, --mz-brand-hover, --mz-brand-text, --mz-brand-soft), no red or brand utilities
 * (text-red-*, bg-brand, text-brand, fill-brand …) and no .mz-orb (a drifting red light). Errors
 * use the danger tokens; a shape that is the view's red renders RedSwatch. The brand's neutrals
 * (brand-ink, brand-paper, brand-line, on-brand) are fine.
 */
const HEX = /#(?:de0000|e33232|ea4643)\b/i;
const VAR = /--mz-(?:red(?:-ink)?|brand(?:-red(?:-hi)?|-hover|-text|-soft)?(?:-rgb)?)(?![\w-])/;
const UTIL = /^(?:[\w-]+:)*!?(?:text|bg|fill|stroke|border|ring|outline|from|to|via|decoration|accent|caret|shadow|divide|placeholder)-(?:red(?:-[\w/]+)?|brand(?:-(?:hover|text|soft|red|red-hi))?(?:\/[\w.]+)?)$/;
const ORB = /^(?:[\w-]+:)*mz-orb(?:--[\w-]+)?$/;

/** What paints the brand red in this text, or null. */
export function brandRed(text) {
  const s = String(text);
  const hex = s.match(HEX);
  if (hex) return hex[0];
  const v = s.match(VAR);
  if (v) return v[0];
  for (const cls of s.split(/\s+/).filter(Boolean)) if (UTIL.test(cls) || ORB.test(cls)) return cls;
  return null;
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "Only the design system's motion components paint the brand red (red once per view)" },
    messages: { red: "'{{what}}' paints the brand red; the red budget hands it out (react/motion), errors use the danger tokens." },
    schema: [],
  },
  create(context) {
    const check = (node, text) => {
      const what = brandRed(text);
      if (what) context.report({ node, messageId: "red", data: { what } });
    };
    return {
      Literal(node) { if (typeof node.value === "string") check(node, node.value); },
      TemplateElement(node) { check(node, node.value.cooked ?? ""); },
    };
  },
};

export default rule;
