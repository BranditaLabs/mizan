/**
 * mizan/no-adhoc-motion (Brand 2.0, docs/16 §2.x): screens never pick an animation. Every loader,
 * spinner, progress bar and success moment goes through the design system's motion components
 * (@mizan/design-system/react/motion) and the event-motion catalogue (@mizan/shared/motion), so the
 * brand's four rules (TIP, MERGE, SETTLE, DROP), reduced motion and "red once per view" hold in one place.
 *
 * Flags, outside packages/design-system:
 *   - every Tailwind animate-* utility but animate-none (spin, ping, pulse, bounce, arbitrary
 *     animate-[…]), the old mz-shimmer and any ld-* loader class
 *   - an inline style that sets animation / animationName (animationDelay on a motion.css class is fine)
 *   - SVG SMIL (<animate>, <animateTransform>, <animateMotion>, <set>): a hand-made spinner
 *   - element.animate(…) outside RouteMotion.tsx (the one allow-listed route transition)
 *   - importing ScaleLoader or LedgerBars (Brand 1.0 loaders, removed)
 *   - raw <mizan-loader> / <mz-*> custom elements (the pack's web components are ported, not used)
 *   - <MizanLoader kind=…> or <EventGlyph outcome=…> with a literal in a screen: the kind and the
 *     outcome come from a surface (PageState, BusyLabel, a catalogue lookup), not from the screen
 *   - toast({ … }) on a success path: inside onSuccess, inside a helper that onSuccess calls, or
 *     after `await m.mutateAsync()`: use toast.event({ type }) or useEventMutation(type)
 * (@keyframes in app CSS is checked by test/no-adhoc-motion.test.ts: ESLint does not read CSS.)
 */
const BANNED_CLASS = /^(?:[\w-]+:)*!?(?:animate-(?!none$)[\w[\]().,%-]+|mz-shimmer|ld-[a-z-]+)$/;
const SMIL = new Set(["animate", "animateTransform", "animateMotion", "set"]);
/**
 * Files that are surfaces themselves (they map a state to a kind), the gallery that shows every kind,
 * and the whole-view frames that own the view's one red (the outage screen, the landing page).
 */
const SURFACE_FILE = /(?:components[\\/]ui[\\/](?:Loader|BusyLabel|Surface|QueryState|PageState|Toast|Button)\.tsx|app[\\/]\[locale\][\\/]ui[\\/][\w]+\.tsx|lib[\\/]motion[\\/][\w]+\.tsx?|components[\\/]OutageScreen\.tsx|landing[\\/]page\.tsx)$/;
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
      toast: "A success toast picks its own motion; use toast.event({ type }) or useEventMutation(type) so the catalogue decides.",
      style: "An inline animation is ad-hoc motion; use a design-system component (animationDelay on a motion.css class is fine).",
      smil: "<{{name}}> is a hand-made SVG animation; use MizanLoader or EventGlyph.",
      pick: "A screen picks the {{what}} itself; let a surface pick it (PageState, Button busy, FillProgress, a catalogue lookup).",
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
    const surfaceFile = SURFACE_FILE.test(file);
    const isOnSuccess = (n) => n.type === "Property" && ((n.key.type === "Identifier" && n.key.name === "onSuccess") || (n.key.type === "Literal" && n.key.value === "onSuccess"));
    const insideOnSuccess = (node) => {
      for (let n = node.parent; n; n = n.parent) if (isOnSuccess(n)) return true;
      return false;
    };
    const isFn = (n) => n.type === "ArrowFunctionExpression" || n.type === "FunctionExpression" || n.type === "FunctionDeclaration";
    /** The name of the helper a node sits in (`const done = () => …`, `function done() …`), or null. */
    const helperName = (node) => {
      for (let n = node.parent; n; n = n.parent) {
        if (!isFn(n)) continue;
        if (n.type === "FunctionDeclaration" && n.id) return n.id.name;
        if (n.parent?.type === "VariableDeclarator" && n.parent.id.type === "Identifier") return n.parent.id.name;
        return null;
      }
      return null;
    };
    const source = context.sourceCode ?? context.getSourceCode();
    /** True when an `await x.mutateAsync(` comes before this node in its function. */
    const afterMutateAsync = (node) => {
      let fn = node.parent;
      while (fn && !isFn(fn)) fn = fn.parent;
      if (!fn) return false;
      const before = source.text.slice(fn.range[0], node.range[0]);
      return /await\s+[\w.]+\.mutateAsync\s*\(/.test(before);
    };
    const helperToasts = []; // [helper name, node]
    const calledInSuccess = new Set();
    return {
      Literal(node) { if (typeof node.value === "string") check(node, node.value); },
      TemplateElement(node) { check(node, node.value.cooked ?? ""); },
      CallExpression(node) {
        const c = node.callee;
        if (!routeMotion && c.type === "MemberExpression" && !c.computed && c.property.type === "Identifier" && c.property.name === "animate" && node.arguments.length >= 1) {
          context.report({ node, messageId: "animate" });
        }
        if (c.type === "Identifier" && c.name === "toast" && node.arguments[0]?.type === "ObjectExpression") {
          if (insideOnSuccess(node) || afterMutateAsync(node)) context.report({ node, messageId: "toast" });
          else { const h = helperName(node); if (h) helperToasts.push([h, node]); }
        }
        if (c.type === "Identifier" && insideOnSuccess(node)) calledInSuccess.add(c.name);
      },
      "Program:exit"() {
        for (const [h, node] of helperToasts) if (calledInSuccess.has(h)) context.report({ node, messageId: "toast" });
      },
      JSXAttribute(node) {
        const name = node.name.type === "JSXIdentifier" ? node.name.name : null;
        // style={{ animation: … }}: ad-hoc motion.
        if (name === "style" && node.value?.type === "JSXExpressionContainer" && node.value.expression.type === "ObjectExpression") {
          for (const p of node.value.expression.properties) {
            const k = p.type === "Property" ? (p.key.type === "Identifier" ? p.key.name : p.key.type === "Literal" ? p.key.value : null) : null;
            if (k === "animation" || k === "animationName") context.report({ node: p, messageId: "style" });
          }
        }
        // <MizanLoader kind="…"> / <EventGlyph outcome="…"> / <Button pending="…">: a screen choosing motion.
        if (surfaceFile || node.value?.type !== "Literal") return;
        const el = node.parent.name.type === "JSXIdentifier" ? node.parent.name.name : null;
        if ((el === "MizanLoader" && name === "kind") || (el === "EventGlyph" && name === "outcome")) {
          context.report({ node, messageId: "pick", data: { what: el === "MizanLoader" ? "loader kind" : "outcome" } });
        }
        if (el === "MizanLoader" && name === "tone" && node.value.value === "brand") context.report({ node, messageId: "pick", data: { what: "brand red" } });
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
        if (node.name.type === "JSXIdentifier" && SMIL.has(node.name.name)) context.report({ node, messageId: "smil", data: { name: node.name.name } });
      },
    };
  },
};

export default rule;
