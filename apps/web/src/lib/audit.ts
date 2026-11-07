/**
 * One label shape for audit actions (docs/16 §4, FX-1), shared by the home's activity, the bell and
 * Settings → Audit log, read from the `auditLog` namespace:
 *  1. `actions.<family>.<rest>` ("member.invited" → actions.member.invited), with any further dots
 *     joined by "_" ("order.status.changed" → actions.order.status_changed);
 *  2. otherwise "A change in <family>" (`actions.inFamily` with `families.<family>`);
 *  3. otherwise "A change in the store" (`actions.other`). A raw code never reaches the screen.
 */
type Translate = { (key: string, values?: Record<string, string>): string; has(key: string): boolean };

export function auditActionKey(action: string): string {
  const [family = "", ...rest] = action.split(".");
  return `actions.${family}.${rest.join("_")}`;
}

/** `t` is `useTranslations("auditLog")`. */
export function auditActionLabel(tr: unknown, action: string): string {
  const t = tr as Translate;
  const key = auditActionKey(action);
  if (t.has(key)) return t(key);
  const family = action.split(".")[0] ?? "";
  if (family && t.has(`families.${family}`)) return t("actions.inFamily", { family: t(`families.${family}`) });
  return t("actions.other");
}

/** Who did it: a person's name, Mizan's team, an automation, an API key … never a raw type. */
export function auditActorLabel(tr: unknown, a: { type: string; displayName: string | null }): string {
  const t = tr as Translate;
  if (a.type === "mizan_staff") return t("actor.mizan");
  if (a.type === "user") return a.displayName ?? t("actor.someone");
  return t.has(`actor.${a.type}`) ? t(`actor.${a.type}`) : t("actor.system");
}
