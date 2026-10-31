/** The landing page's plans (docs/01-business-model.md): Egypt in EGP, the GCC in USD, a month at a time. */
export type PlanId = "free" | "growth" | "scale" | "enterprise";

export const PLANS: { id: PlanId; egp?: number; usd?: number; features: number }[] = [
  { id: "free", egp: 0, usd: 0, features: 4 },
  { id: "growth", egp: 2500, usd: 99, features: 5 },
  { id: "scale", egp: 6500, usd: 299, features: 5 },
  { id: "enterprise", features: 4 },
];

/** Annual billing is 2 months free: ten months' price over twelve, shown per month. */
export const monthlyPrice = (monthly: number, annual: boolean) => (annual ? Math.round((monthly * 10) / 12) : monthly);

/** Western digits with thousands separators; GCC prices carry the dollar sign, Egyptian ones the unit after them. */
export const formatPrice = (amount: number, usd: boolean) => `${usd ? "$" : ""}${amount.toLocaleString("en-US")}`;
