/**
 * Server-side messages in Arabic (Egyptian, for merchants) and English.
 * Error `code`s are stable; these titles are what people read.
 */

export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];

const PROBLEM_TITLES = {
  bad_request: { en: "Bad request", ar: "الطلب مش صحيح" },
  unauthorized: { en: "Sign-in required", ar: "لازم تسجّل الدخول" },
  forbidden: { en: "Not allowed", ar: "مش مسموح لك بالإجراء ده" },
  not_found: { en: "Not found", ar: "مش موجود" },
  method_not_allowed: { en: "Method not allowed", ar: "الطريقة دي مش مسموحة" },
  conflict: { en: "Conflict", ar: "فيه تعارض مع بيانات موجودة" },
  precondition_failed: { en: "Changed by someone else", ar: "البيانات اتغيّرت من حد تاني" },
  payload_too_large: { en: "Request too large", ar: "الطلب حجمه كبير" },
  validation_failed: { en: "Validation failed", ar: "البيانات فيها أخطاء" },
  rate_limited: { en: "Too many requests", ar: "طلبات كتير، جرّب كمان شوية" },
  token_invalid: { en: "Sign-in not valid", ar: "تسجيل الدخول مش صالح" },
  token_expired: { en: "Sign-in expired", ar: "تسجيل الدخول انتهى، سجّل تاني" },
  auth_not_configured: { en: "Sign-in not configured", ar: "تسجيل الدخول مش متفعّل على السيرفر" },
  tenant_header_required: { en: "Choose a store", ar: "اختار المتجر الأول" },
  invalid_tenant_id: { en: "Invalid store id", ar: "رقم المتجر مش صحيح" },
  not_a_member: { en: "Not a member of this store", ar: "انت مش عضو في المتجر ده" },
  tenant_inactive: { en: "Store is not active", ar: "المتجر ده مش متفعّل" },
  mfa_required: { en: "Two-step verification required", ar: "لازم تفعّل التحقق بخطوتين" },
  insufficient_role: { en: "Your role cannot do this", ar: "صلاحيتك متسمحش بالإجراء ده" },
  slug_taken: { en: "Store address taken", ar: "عنوان المتجر ده مستخدم" },
  tenant_limit_reached: { en: "Store limit reached", ar: "وصلت للحد الأقصى من المتاجر" },
  already_member: { en: "Already a member", ar: "الشخص ده عضو بالفعل" },
  invitation_not_found: { en: "Invitation not found", ar: "الدعوة مش موجودة أو انتهت" },
  member_not_found: { en: "Member not found", ar: "العضو مش موجود" },
  cannot_change_self: { en: "You cannot change your own access", ar: "مينفعش تغيّر صلاحيتك بنفسك" },
  last_owner: { en: "A store needs an owner", ar: "المتجر لازم يكون له صاحب واحد على الأقل" },
  secret_not_found: { en: "Credential not found", ar: "بيانات الربط مش موجودة" },
  job_not_found: { en: "Job not found", ar: "المهمة مش موجودة" },
  store_not_connected: { en: "Store not connected", ar: "المتجر مش مربوط" },
  shopify_not_configured: { en: "Shopify is not set up on this server", ar: "ربط شوبيفاي مش متفعّل على السيرفر" },
  invalid_shop: { en: "Not a Shopify store address", ar: "ده مش عنوان متجر شوبيفاي" },
  install_not_found: { en: "Install link not found or already used", ar: "رابط التثبيت مش موجود أو اتستخدم قبل كده" },
  install_expired: { en: "Install link expired", ar: "رابط التثبيت انتهى، ثبّت التطبيق تاني" },
  install_not_yours: { en: "This install was started by someone else", ar: "التثبيت ده بدأه شخص تاني" },
  shop_connected_elsewhere: { en: "This Shopify store is connected to another account", ar: "متجر شوبيفاي ده مربوط بحساب تاني" },
  store_limit_reached: { en: "One Shopify store per account for now", ar: "حاليًا متجر شوبيفاي واحد بس لكل حساب" },
  invalid_idempotency_key: { en: "Invalid Idempotency-Key", ar: "مفتاح التكرار مش صحيح" },
  idempotency_key_reused: { en: "Idempotency-Key already used", ar: "مفتاح التكرار ده اتستخدم لطلب تاني" },
  idempotency_key_in_progress: { en: "Request still running", ar: "الطلب الأول لسه شغال، جرّب كمان شوية" },
  internal_error: { en: "Something went wrong", ar: "حصلت مشكلة عندنا" },
  service_unavailable: { en: "Service unavailable", ar: "الخدمة مش متاحة دلوقتي" },
} as const satisfies Record<string, Record<Locale, string>>;

export type ProblemCode = keyof typeof PROBLEM_TITLES;

export function isProblemCode(code: string): code is ProblemCode {
  return Object.hasOwn(PROBLEM_TITLES, code);
}

export function problemTitle(code: string, locale: Locale): string | undefined {
  return isProblemCode(code) ? PROBLEM_TITLES[code][locale] : undefined;
}

/** Pick ar or en from an Accept-Language header. Arabic is the default, as in the dashboard. */
export function localeFrom(acceptLanguage: string | undefined): Locale {
  if (!acceptLanguage) return "ar";
  const ranked = acceptLanguage
    .split(",")
    .map((part, i) => {
      const [tag = "", ...params] = part.trim().toLowerCase().split(";");
      const q = Number(params.find((p) => p.trim().startsWith("q="))?.split("=")[1] ?? 1);
      return { lang: tag.split("-")[0], q: Number.isFinite(q) ? q : 0, i };
    })
    .filter((x) => x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  const hit = ranked.find((x) => (LOCALES as readonly string[]).includes(x.lang ?? ""));
  return (hit?.lang as Locale | undefined) ?? "ar";
}
