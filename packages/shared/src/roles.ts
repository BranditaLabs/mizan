/**
 * Member roles (docs/02 §7). Mirrors the CHECK constraint on memberships.role.
 * Cashier (POS, V3) is added with its migration.
 */
export const MEMBER_ROLES = ["owner", "admin", "ops_manager", "agent", "warehouse", "finance", "media_buyer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const MEMBERSHIP_STATUSES = ["invited", "active", "disabled"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** Roles that must sign in with a second factor in production (docs/07 §1). */
export const MFA_REQUIRED_ROLES: ReadonlySet<MemberRole> = new Set(["owner", "admin"]);

export const ROLE_LABELS: Readonly<Record<MemberRole, { en: string; ar: string }>> = {
  owner: { en: "Owner", ar: "صاحب البيزنس" },
  admin: { en: "Admin", ar: "أدمن" },
  ops_manager: { en: "Ops manager", ar: "مدير العمليات" },
  agent: { en: "Agent", ar: "موظف تأكيد / خدمة عملاء" },
  warehouse: { en: "Warehouse", ar: "المخزن" },
  finance: { en: "Finance", ar: "الحسابات" },
  media_buyer: { en: "Media buyer", ar: "ميديا باير" },
};

export function isMemberRole(value: string): value is MemberRole {
  return (MEMBER_ROLES as readonly string[]).includes(value);
}
