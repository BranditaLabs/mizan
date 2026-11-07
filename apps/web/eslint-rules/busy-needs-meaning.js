/**
 * mizan/busy-needs-meaning (Brand 2.0 meanings, docs/08 §motion): a busy control says what the
 * press does, never an animation, and nothing falls back to the save animation (DROP). The types
 * already refuse most of this (Button/IconButton/ConfirmDialog BusyProps, PrimaryCta busyAs,
 * MizanLoader fill value); this rule is the belt for what types cannot see (spread props, `any`,
 * plain JS) and for the warnings types cannot give.
 *
 * Flags:
 *   - <Button|IconButton|ConfirmDialog busy={…}> with no `as`, unless `busy` is an object literal
 *     ({ isPending, motion }) or a variable bound to useEventMutation(…) in the same file
 *   - <PrimaryCta busy=…> with no `busyAs`
 *   - <MizanLoader kind="fill"> with no `value` (FILL is known progress: it needs a real value)
 *   - `pending=` on Button or IconButton outside src/components/ui (screens name a meaning: `as`)
 *   - silentWrite (a warning, its own rule): `disabled={x.isPending}` on a Switch, a select or an IconButton with no `busy`: a
 *     write with no motion
 */
const BUSY_HOSTS = new Set(["Button", "IconButton", "ConfirmDialog"]);
const UI_FILE = /[\\/]components[\\/]ui[\\/]/;

const nameOf = (n) => (n.name.type === "JSXIdentifier" ? n.name.name : null);
const attr = (n, name) => n.attributes.find((a) => a.type === "JSXAttribute" && a.name.name === name);
const isPendingExpr = (e) => e && e.type === "MemberExpression" && e.property.type === "Identifier" && e.property.name === "isPending";

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: { description: "A busy control names what the press does (a meaning or an event), never an animation, with no default" },
    messages: {
      busy: "<{{name}} busy> names no meaning: add as=\"loading|signingIn|checking|syncing|sending|saving|creating\" (or pass a useEventMutation result).",
      cta: "<PrimaryCta busy> needs busyAs (signingIn, checking, sending, creating, saving): there is no default loader.",
      fill: "<MizanLoader kind=\"fill\"> needs a real value: an indeterminate wait is pair, transfer or drop (use FillProgress with done/total).",
      pending: "`pending=` picks an animation; a screen names the meaning with `as=` (only components/ui pass a loader).",
      silent: "A control disabled while a write runs shows no motion: give it busy={…} with as=, or show a Waiting beside it.",
    },
    schema: [],
  },
  create(context) {
    const file = context.filename ?? context.getFilename();
    const ui = UI_FILE.test(file);
    /** Variables bound to useEventMutation(…) (their busy object names the event). */
    const eventMutations = new Set();
    return {
      VariableDeclarator(node) {
        const init = node.init;
        if (node.id.type === "Identifier" && init && init.type === "CallExpression" && init.callee.type === "Identifier" && init.callee.name === "useEventMutation") {
          eventMutations.add(node.id.name);
        }
      },
      "JSXOpeningElement:exit"(node) {
        const name = nameOf(node);
        if (!name) return;
        const busy = attr(node, "busy");
        if (BUSY_HOSTS.has(name) && busy && !attr(node, "as")) {
          const v = busy.value;
          const expr = v && v.type === "JSXExpressionContainer" ? v.expression : null;
          const ok = expr && (expr.type === "ObjectExpression" || (expr.type === "Identifier" && eventMutations.has(expr.name))
            || (expr.type === "Literal" && expr.value === false));
          if (!ok) context.report({ node, messageId: "busy", data: { name } });
        }
        if (name === "PrimaryCta" && busy && !attr(node, "busyAs")) context.report({ node, messageId: "cta" });
        if (name === "MizanLoader") {
          const kind = attr(node, "kind");
          if (kind && kind.value && kind.value.type === "Literal" && kind.value.value === "fill" && !attr(node, "value")) context.report({ node, messageId: "fill" });
        }
        if ((name === "Button" || name === "IconButton") && attr(node, "pending") && !ui) context.report({ node, messageId: "pending" });
      },
    };
  },
};

/**
 * mizan/silent-write (warn): a Switch, select or IconButton disabled by a running write, with no busy.
 * @type {import("eslint").Rule.RuleModule}
 */
export const silentWrite = {
  meta: { type: "suggestion", docs: { description: "A control disabled while a write runs shows its motion" }, messages: { silent: rule.meta.messages.silent }, schema: [] },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const name = nameOf(node);
        if (name !== "Switch" && name !== "select" && name !== "IconButton") return;
        const d = attr(node, "disabled");
        const e = d && d.value && d.value.type === "JSXExpressionContainer" ? d.value.expression : null;
        const writes = isPendingExpr(e) || (e && e.type === "LogicalExpression" && (isPendingExpr(e.left) || isPendingExpr(e.right)));
        // A native control has no busy prop: aria-busy with its loader beside it counts.
        if (writes && !attr(node, "busy") && !attr(node, "aria-busy")) context.report({ node, messageId: "silent" });
      },
    };
  },
};

export default rule;
