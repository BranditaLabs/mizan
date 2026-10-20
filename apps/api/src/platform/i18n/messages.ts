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
