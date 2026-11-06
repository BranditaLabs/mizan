import { BUYER_CANCEL_REASONS, type BuyerCancelReason } from "@mizan/shared";
import type { Pack, ReasonItem, ScriptKey } from "./catalogue.js";

/**
 * The starting wording per pack (E6-16a). Egyptian is the chat's original wording, word for word;
 * formal is Modern Standard Arabic; gulf is Saudi and Gulf Arabic. Packs are Arabic dialects only:
 * English is the same in every pack. Optional keys (header, section, footer, a row's description)
 * have no pack text, and `call` has none in Egyptian: code composes its lines.
 */
type Texts = Partial<Record<ScriptKey, string>>;

const EGYPTIAN_AR: Texts = {
  confirmed: "تمام ✅ أوردرك {{order.number}} اتأكّد وهنشحنه قريب. شكراً إنك اخترت {{store.name}}!",
  confirmed_offer_top: "تمام ✅ أوردرك {{order.number}} اتأكّد.",
  change_prompt: "اكتب لنا التعديل اللي عايزه في رسالة (المقاس، اللون، العنوان أو المعاد)، وفريقنا هيكلّمك.",
  change_received: "وصلنا ✍️ فريق {{store.name}} هيكلّمك قريب.",
  cancel_prompt: "خسارة 😔 ممكن تقولنا ليه عايز تلغي؟",
  cancel_button: "اختار السبب",
  keep_title: "لا، كمّل الأوردر",
  cancelled: "اتلغى أوردرك {{order.number}}. لو غيّرت رأيك ابعتلنا في أي وقت.",
  offer_pitch: "🎁 عرض ليك: {{offer.line}}.",
  offer_question: "تحب نضيفه لنفس الأوردر؟",
  btn_offer_yes: "ضيفه",
  btn_offer_no: "لا شكراً",
  offer_added: "تمام ✅ هنضيف {{offer.title}} لأوردرك، والإجمالي الجديد {{offer.new_total}}.",
  offer_added_generic: "تمام ✅ هنضيفه لأوردرك.",
  offer_failed: "معلش، مقدرناش نضيف {{offer.title}} لأوردرك دلوقتي. فريق {{store.name}} هيكلّمك يظبطها معاك.",
  offer_failed_generic: "معلش، مقدرناش نضيف العرض دلوقتي. فريق {{store.name}} هيكلّمك.",
  offer_declined: "ولا يهمك 🙏 أوردرك ماشي زي ما هو.",
  offer_expired: "العرض ده خلص، بس أوردرك ماشي زي ما هو 🙏",
  summary_pay: "💵 هتدفع للمندوب: {{summary.due}}",
  summary_paid: "💳 مدفوع",
  summary_more: "و{{summary.more}} منتج كمان",
  summary_area: "📍 {{order.city}}",
  noted: "وصلنا ✍️ فريق {{store.name}} هيكلّمك قريب.",
  already: "أوردرك {{order.number}} متسجّل قبل كده. لو محتاج حاجة اكتبلنا هنا وفريقنا هيساعدك.",
  opted_out: "تمام، مش هنبعتلك رسايل تاني هنا من {{store.name}}. لو حبيت ترجع اكتب {{start_keyword}}.",
  opted_in: "أهلاً بيك تاني 👋 هنبعتلك تحديثات أوردراتك من {{store.name}} هنا.",
  on_delivery: "عند الاستلام",
  link_text: "{{customer.greeting}}، أوردرك {{order.number}} من {{store.name}} بـ {{order.due}}. أكّده أو عدّله من هنا: {{link}}",
};

const FORMAL_AR: Texts = {
  confirmed: "تم ✅ تأكيد طلبك {{order.number}} وسيتم شحنه قريباً. شكراً لاختيارك {{store.name}}.",
  confirmed_offer_top: "تم ✅ تأكيد طلبك {{order.number}} وسيتم شحنه قريباً. شكراً لاختيارك {{store.name}}.",
  change_prompt: "يرجى كتابة التعديل المطلوب في رسالة (المقاس أو اللون أو العنوان أو الموعد)، وسيتواصل معك فريقنا.",
  change_received: "تم الاستلام ✍️ سيتواصل معك فريق {{store.name}} قريباً.",
  cancel_prompt: "نأسف لذلك 😔 هل يمكنك إخبارنا بسبب الإلغاء؟",
  cancel_button: "اختر السبب",
  keep_title: "لا، أكمل الطلب",
  cancelled: "تم إلغاء طلبك {{order.number}}. يسعدنا تواصلك معنا في أي وقت.",
  offer_pitch: "🎁 عرض خاص لك: {{offer.line}}.",
  offer_question: "هل تودّ إضافته إلى الطلب نفسه؟",
  btn_offer_yes: "أضفه",
  btn_offer_no: "لا، شكراً",
  offer_added: "تم ✅ ستتم إضافة {{offer.title}} إلى طلبك، ويصبح الإجمالي الجديد {{offer.new_total}}.",
  offer_added_generic: "تم ✅ ستتم إضافته إلى طلبك.",
  offer_failed: "نعتذر، لم نتمكن من إضافة {{offer.title}} إلى طلبك حالياً. سيتواصل معك فريق {{store.name}} لإتمام ذلك.",
  offer_failed_generic: "نعتذر، لم نتمكن من إضافة العرض حالياً. سيتواصل معك فريق {{store.name}}.",
  offer_declined: "لا بأس 🙏 سيبقى طلبك كما هو.",
  offer_expired: "انتهى هذا العرض، وسيستمر طلبك كما هو 🙏",
  summary_pay: "💵 المبلغ المستحق للمندوب: {{summary.due}}",
  summary_paid: "💳 مدفوع",
  summary_more: "و{{summary.more}} من المنتجات الأخرى",
  summary_area: "📍 {{order.city}}",
  noted: "تم الاستلام ✍️ سيتواصل معك فريق {{store.name}} قريباً.",
  already: "طلبك {{order.number}} مسجّل مسبقاً. إن احتجت أي شيء فراسلنا هنا وسيساعدك فريقنا.",
  opted_out: "تم، لن نرسل إليك رسائل أخرى هنا من {{store.name}}. للعودة اكتب {{start_keyword}}.",
  opted_in: "أهلاً بك مجدداً 👋 سنرسل إليك تحديثات طلباتك من {{store.name}} هنا.",
  on_delivery: "عند الاستلام",
  link_text: "{{customer.greeting}}، طلبك {{order.number}} من {{store.name}} بقيمة {{order.due}}. يمكنك تأكيده أو تعديله من هنا: {{link}}",
  call: "مرحباً {{customer.first_name}}، معك فريق {{store.name}}.\nنتصل لتأكيد طلبك رقم {{order.number}}: {{order.items}}.\nالإجمالي {{order.cod}}.\nهل نؤكد الطلب ونشحنه لك؟",
};

const GULF_AR: Texts = {
  confirmed: "تم ✅ طلبك {{order.number}} تأكّد وبنشحنه لك قريب. شكراً لأنك اخترت {{store.name}}!",
  confirmed_offer_top: "تم ✅ طلبك {{order.number}} تأكّد.",
  change_prompt: "اكتب لنا التعديل اللي تبيه في رسالة (المقاس، اللون، العنوان أو الموعد)، وفريقنا بيتواصل معك.",
  change_received: "وصلتنا ✍️ فريق {{store.name}} بيتواصل معك قريب.",
  cancel_prompt: "يا خسارة 😔 ممكن تقول لنا ليش تبي تلغي؟",
  cancel_button: "اختر السبب",
  keep_title: "لا، كمّل الطلب",
  cancelled: "تم إلغاء طلبك {{order.number}}. لو غيّرت رأيك راسلنا أي وقت.",
  offer_pitch: "🎁 عرض خاص لك: {{offer.line}}.",
  offer_question: "تبينا نضيفه لنفس الطلب؟",
  btn_offer_yes: "أضفه",
  btn_offer_no: "لا، شكراً",
  offer_added: "تم ✅ بنضيف {{offer.title}} لطلبك، والإجمالي الجديد {{offer.new_total}}.",
  offer_added_generic: "تم ✅ بنضيفه لطلبك.",
  offer_failed: "المعذرة، ما قدرنا نضيف {{offer.title}} لطلبك الحين. فريق {{store.name}} بيتواصل معك ويرتّبها.",
  offer_failed_generic: "المعذرة، ما قدرنا نضيف العرض الحين. فريق {{store.name}} بيتواصل معك.",
  offer_declined: "ولا يهمك 🙏 طلبك ماشي مثل ما هو.",
  offer_expired: "العرض هذا انتهى، بس طلبك ماشي مثل ما هو 🙏",
  summary_pay: "💵 بتدفع للمندوب: {{summary.due}}",
  summary_paid: "💳 مدفوع",
  summary_more: "و{{summary.more}} منتج ثاني",
  summary_area: "📍 {{order.city}}",
  noted: "وصلتنا ✍️ فريق {{store.name}} بيتواصل معك قريب.",
  already: "طلبك {{order.number}} مسجّل من قبل. لو تحتاج أي شي اكتب لنا هنا وفريقنا يساعدك.",
  opted_out: "أبشر، ما راح نرسل لك رسائل هنا مرة ثانية من {{store.name}}. لو حاب ترجع اكتب {{start_keyword}}.",
  opted_in: "هلا فيك من جديد 👋 بنرسل لك تحديثات طلباتك من {{store.name}} هنا.",
  on_delivery: "عند الاستلام",
  link_text: "{{customer.greeting}}، طلبك {{order.number}} من {{store.name}} بـ {{order.due}}. أكّده أو عدّله من هنا: {{link}}",
  call: "هلا {{customer.first_name}}، معك فريق {{store.name}}.\nنتصل عشان نأكد طلبك رقم {{order.number}}: {{order.items}}.\nالإجمالي {{order.cod}}.\nنأكد الطلب ونشحنه لك؟",
};

const EN: Texts = {
  confirmed: "Done ✅ your order {{order.number}} is confirmed and will ship soon. Thanks for choosing {{store.name}}!",
  confirmed_offer_top: "Done ✅ your order {{order.number}} is confirmed.",
  change_prompt: "Write the change you need in a message (size, colour, address or time) and our team will call you.",
  change_received: "Got it ✍️ the {{store.name}} team will call you shortly.",
  cancel_prompt: "Sorry to hear that 😔 why do you want to cancel?",
  cancel_button: "Choose a reason",
  keep_title: "No, keep my order",
  cancelled: "Your order {{order.number}} is cancelled. If you change your mind, message us anytime.",
  offer_pitch: "🎁 An offer for you: {{offer.line}}.",
  offer_question: "Shall we add it to the same order?",
  btn_offer_yes: "Add it",
  btn_offer_no: "No, thanks",
  offer_added: "Done ✅ we'll add {{offer.title}} to your order; the new total is {{offer.new_total}}.",
  offer_added_generic: "Done ✅ we'll add it to your order.",
  offer_failed: "Sorry, we couldn't add {{offer.title}} to your order just now. The {{store.name}} team will call you to sort it out.",
  offer_failed_generic: "Sorry, we couldn't add the offer just now. The {{store.name}} team will call you.",
  offer_declined: "No problem 🙏 your order stays as it is.",
  offer_expired: "This offer has ended, but your order goes ahead as it is 🙏",
  summary_pay: "💵 Pay the courier: {{summary.due}}",
  summary_paid: "💳 Paid",
  summary_more: "and {{summary.more}} more",
  summary_area: "📍 {{order.city}}",
  noted: "Got it ✍️ the {{store.name}} team will call you shortly.",
  already: "Your order {{order.number}} is already recorded. If you need anything, write to us here and our team will help.",
  opted_out: "Done, {{store.name}} won't message you here again. To start again, write {{start_keyword}}.",
  opted_in: "Welcome back 👋 {{store.name}} will send your order updates here.",
  on_delivery: "on delivery",
  link_text: "{{customer.greeting}}, your order {{order.number}} from {{store.name}} is {{order.due}}. Confirm or change it here: {{link}}",
};

export const PACK_TEXTS: Record<Pack, Record<"ar" | "en", Texts>> = {
  egyptian: { ar: EGYPTIAN_AR, en: EN },
  formal: { ar: FORMAL_AR, en: EN },
  gulf: { ar: GULF_AR, en: EN },
};

type Titles = Record<BuyerCancelReason, string>;
const REASON_EN: Titles = { changed_mind: "Changed my mind", ordered_by_mistake: "Ordered by mistake", found_cheaper: "Found it cheaper", delivery_too_late: "Delivery is too late", other: "Another reason" };
const REASON_AR: Record<Pack, Titles> = {
  egyptian: { changed_mind: "غيّرت رأيي", ordered_by_mistake: "طلبته بالغلط", found_cheaper: "لقيته أرخص", delivery_too_late: "التوصيل هيتأخر عليّا", other: "سبب تاني" },
  formal: { changed_mind: "عدلت عن رأيي", ordered_by_mistake: "طلبته عن طريق الخطأ", found_cheaper: "وجدته بسعر أقل", delivery_too_late: "موعد التوصيل متأخر", other: "سبب آخر" },
  gulf: { changed_mind: "غيّرت رأيي", ordered_by_mistake: "طلبته بالغلط", found_cheaper: "لقيته أرخص", delivery_too_late: "التوصيل بيتأخر علي", other: "سبب ثاني" },
};

/** The pack's five reasons; their ids are the canonical codes. */
export const PACK_REASONS: Record<Pack, ReasonItem[]> = Object.fromEntries((Object.keys(REASON_AR) as Pack[]).map((p) =>
  [p, BUYER_CANCEL_REASONS.map((code) => ({ id: code, code, title: { ar: REASON_AR[p][code], en: REASON_EN[code] } }))])) as Record<Pack, ReasonItem[]>;

/** The pack's title for a canonical code, when a store's reason has none in that language. */
export const packReasonTitle = (pack: Pack, lang: "ar" | "en", code: BuyerCancelReason) => (lang === "ar" ? REASON_AR[pack][code] : REASON_EN[code]);

type Greet = (firstName: string | null) => string;
/** `{{customer.greeting}}` and the template's {{1}}: with the first name, or a welcome without one. */
export const GREETING: Record<Pack, Record<"ar" | "en", Greet>> = {
  egyptian: { ar: (n) => (n ? `أهلاً ${n}` : "أهلاً بيك"), en: (n) => (n ? `Hi ${n}` : "Hi") },
  formal: { ar: (n) => (n ? `أهلاً ${n}` : "أهلاً بك"), en: (n) => (n ? `Hi ${n}` : "Hi") },
  gulf: { ar: (n) => (n ? `هلا ${n}` : "حيّاك الله"), en: (n) => (n ? `Hi ${n}` : "Hi") },
};

/** `{{customer.first_name}}` when the order has no name. */
export const NAMELESS: Record<Pack, Record<"ar" | "en", string>> = {
  egyptian: { ar: "حضرتك", en: "there" },
  formal: { ar: "عميلنا الكريم", en: "there" },
  gulf: { ar: "عميلنا العزيز", en: "there" },
};
