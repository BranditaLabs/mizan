import type { MemberRole } from "./roles.js";

/**
 * Who may do what in a store (U6), in one place. The API guards each route with one of these
 * (`@Can("orders.read")`), the web shows or hides each place and button with the same name
 * (`useCan`), and GET /v1/me lists a member's permissions. To change who can do something,
 * change it here: the route, the menu and the buttons follow.
 */
const O = ["owner"] as const;
const OA = ["owner", "admin"] as const;
const OAM = [...OA, "ops_manager"] as const;
const OAF = [...OA, "finance"] as const;
const OAMF = [...OAM, "finance"] as const;
const OAMA = [...OAM, "agent"] as const;
const OAMW = [...OAM, "warehouse"] as const;
const OAMAW = [...OAM, "agent", "warehouse"] as const;
const OAMFW = [...OAMF, "warehouse"] as const;
const OAMFA = [...OAMF, "agent"] as const;
const OAMFAW = [...OAMF, "agent", "warehouse"] as const;

export const PERMISSIONS = {
  // Orders
  "orders.read": OAMFAW,
  "orders.create": OAMA,
  "orders.handle": OAMAW,
  "orders.bulk": OAMW,
  "orders.settings": OAM,
  /** Leads: delete others' notes, share and remove shared views, bulk actions (checked in the orders service). */
  "orders.lead": OAM,
  // Confirmation and offers
  "confirmation.work": OAMA,
  "confirmation.manage": OAM,
  "offers.manage": OAM,
  "offers.results": OAMF,
  // Tickets, returns, exchanges, the door
  "tickets.read": OAMFAW,
  "tickets.create": OAMFA,
  "tickets.work": OAMFAW,
  "exchanges.read": OAMFAW,
  "exchanges.create": OAMA,
  "returns.read": OAMFW,
  "returns.inspect": OAMW,
  "delivery.partial": OAMW,
  "delivery.refusal": OAMAW,
  // Shipping
  "shipments.read": OAMFAW,
  "shipments.manage": OAM,
  "shipping.ship": OAMW,
  "couriers.scorecard": OAMF,
  // Products, stock, warehouse, purchasing
  "products.read": OAMF,
  "products.manage": OAM,
  "stock.read": OAMFW,
  "stock.manage": OAMW,
  "inventory.settings": OAM,
  "picking.work": OAMW,
  "ops.devices": OAMW,
  "suppliers.read": OAMF,
  "purchasing.read": OAMFW,
  "purchasing.manage": OAM,
  "purchasing.receive": OAMW,
  "purchasing.plan": OAMF,
  "purchasing.settings": OA,
  /** Approve a purchase order over the owner's limit (checked in the purchasing service). */
  "purchasing.approve_large": OA,
  // Money
  "payments.read": OAMF,
  "payments.record": OAF,
  "payments.convert": OAMFA,
  "payments.settings.read": OAMF,
  "payments.settings": OAF,
  "refunds.read": OAMF,
  "refunds.request": OAMF,
  "refunds.approve": OAF,
  "refunds.settings": OA,
  "disputes.read": OAMF,
  "disputes.manage": OAF,
  "profit.read": OAMF,
  "profit.manage": OAF,
  "ads.read": [...OAMF, "media_buyer"],
  "ads.spend": [...OAF, "media_buyer"],
  "ads.backfill": OA,
  "billing.read": OAF,
  "billing.manage": OA,
  "reports.read": OAMFAW,
  // Automations
  "automations.manage": OAM,
  // The store, its team and its connections
  "store.manage": OA,
  "team.manage": OA,
  "team.assignable": OAM,
  "audit.read": OA,
  "privacy.manage": OA,
  "connections.read": OAM,
  "connections.manage": OA,
  "whatsapp.connect": OA,
  "onboarding.manage": OA,
  "support.end": OA,
  "legal.accept": O,
} as const satisfies Record<string, readonly MemberRole[]>;

export type Permission = keyof typeof PERMISSIONS;

/** Permissions the API checks inside a service rather than on a route (the rest each guard a route). */
export const SERVICE_CHECKED: readonly Permission[] = ["orders.lead", "purchasing.approve_large"];

export const PERMISSION_NAMES = Object.keys(PERMISSIONS) as Permission[];

/** Whether a member with this role may do it. */
export function can(role: string | null | undefined, permission: Permission): boolean {
  return Boolean(role) && (PERMISSIONS[permission] as readonly string[]).includes(role!);
}

/** Every permission a role has (GET /v1/me). */
export function permissionsFor(role: string | null | undefined): Permission[] {
  return PERMISSION_NAMES.filter((p) => can(role, p));
}

/** The roles that have a permission, as a set (for code that asks `.has(role)`). */
export function rolesWith(permission: Permission): ReadonlySet<string> {
  return new Set<string>(PERMISSIONS[permission]);
}
