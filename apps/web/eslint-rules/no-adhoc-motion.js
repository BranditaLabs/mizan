/**
 * mizan/no-adhoc-motion (Brand 2.0, docs/16 §2.x): screens never pick an animation. Every loader,
 * spinner, progress bar and success moment goes through the design system's motion components
 * (@mizan/design-system/react/motion) and the event-motion catalogue (@mizan/shared/motion), so the
 * brand's four rules (TIP, MERGE, SETTLE, DROP), reduced motion and "red once per view" hold in one place.
 *
 * Flags, outside packages/design-system:
 *   - Tailwind's animate-spin, animate-ping, animate-pulse, the old mz-shimmer and any ld-* loader class
 *   - element.animate(…) outside RouteMotion.tsx (the one allow-listed route transition)
 *   - importing ScaleLoader or LedgerBars (Brand 1.0 loaders, removed)
 *   - raw <mizan-loader> / <mz-*> custom elements (the pack's web components are ported, not used)
 *   - toast({ … }) inside a mutation's onSuccess: use toast.event({ type }) or useEventMutation(type)
 * (@keyframes in app CSS is checked by test/no-adhoc-motion.test.ts: ESLint does not read CSS.)
 */
const BANNED_CLASS = /^(?:[\w-]+:)*(?:animate-spin|animate-ping|animate-pulse|mz-shimmer|ld-[a-z-]+)$/;
const OLD_LOADERS = new Set(["ScaleLoader", "LedgerBars"]);

/** The banned motion class in a class list, or null. */
export function bannedClass(text) {
  for (const cls of String(text).split(/\s+/).filter(Boolean)) if (BANNED_CLASS.test(cls)) return cls;
  return null;
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "Motion comes from the design system's components and the event-motion catalogue, never ad hoc" },
    messages: {
      cls: "'{{cls}}' is ad-hoc motion; use MizanLoader, PageState, a busy Button or FillProgress (@mizan/design-system/react/motion).",
      animate: "element.animate() is ad-hoc motion; use the motion.css classes through a design-system component (RouteMotion is the only exception).",
      loader: "'{{name}}' is a Brand 1.0 loader; use MizanLoader, PageState or BootLoader.",
      element: "<{{name}}> is the brand pack's raw web component; use the ported React component from @mizan/design-system/react/motion.",
      toast: "A success toast inside onSuccess picks its own motion; use toast.event({ type }) or useEventMutation(type) so the catalogue decides.",
    },
    schema: [],
  },
  create(context) {
    const file = context.filename ?? context.getFilename();
    const routeMotion = /RouteMotion\.tsx$/.test(file);
    const check = (node, text) => {
      const cls = bannedClass(text);
      if (cls) context.report({ node, messageId: "cls", data: { cls } });
    };
    const insideOnSuccess = (node) => {
      for (let n = node.parent; n; n = n.parent) {
        if (n.type === "Property" && ((n.key.type === "Identifier" && n.key.name === "onSuccess") || (n.key.type === "Literal" && n.key.value === "onSuccess"))) return true;
      }
      return false;
    };
    return {
      Literal(node) { if (typeof node.value === "string") check(node, node.value); },
      TemplateElement(node) { check(node, node.value.cooked ?? ""); },
      CallExpression(node) {
        const c = node.callee;
        if (!routeMotion && c.type === "MemberExpression" && !c.computed && c.property.type === "Identifier" && c.property.name === "animate" && node.arguments.length >= 1) {
          context.report({ node, messageId: "animate" });
        }
        if (c.type === "Identifier" && c.name === "toast" && node.arguments[0]?.type === "ObjectExpression" && insideOnSuccess(node)) {
          context.report({ node, messageId: "toast" });
        }
      },
      ImportDeclaration(node) {
        for (const s of node.specifiers) {
          const name = s.type === "ImportSpecifier" ? (s.imported.name ?? s.imported.value) : null;
          if (name && OLD_LOADERS.has(name)) context.report({ node: s, messageId: "loader", data: { name } });
        }
      },
      JSXOpeningElement(node) {
        if (node.name.type === "JSXIdentifier" && /^(?:mizan-loader|mz-[a-z-]+)$/.test(node.name.name)) {
          context.report({ node, messageId: "element", data: { name: node.name.name } });
        }
      },
    };
  },
};

export default rule;
