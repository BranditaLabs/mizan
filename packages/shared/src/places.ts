/**
 * Where an order goes, as people say it (manual orders, address edits, courier city matching).
 * Egypt by governorate, each with the cities and districts people actually type, in Arabic and
 * English; Saudi Arabia by region; the UAE by emirate. `courier` is the governorate's name on
 * Bosta where it is known (its cities are the governorates); otherwise its names are matched
 * against Bosta's list. A district such as "Sheraton" still books as Cairo.
 */
export interface Area { en: string; ar: string; also?: readonly string[] }
export interface Region { code: string; en: string; ar: string; courier?: string; also?: readonly string[]; areas: readonly Area[] }

const a = (en: string, ar: string, ...also: string[]): Area => (also.length ? { en, ar, also } : { en, ar });

export const EG_GOVERNORATES: readonly Region[] = [
  { code: "C", en: "Cairo", ar: "القاهرة", courier: "Cairo", areas: [
    a("Nasr City", "مدينة نصر"), a("Heliopolis", "مصر الجديدة"), a("Sheraton", "شيراتون", "sheraton heliopolis"), a("New Cairo", "القاهرة الجديدة", "fifth settlement", "التجمع الخامس", "tagamoa"),
    a("Maadi", "المعادي"), a("Zamalek", "الزمالك"), a("Downtown", "وسط البلد"), a("Shubra", "شبرا"), a("Ain Shams", "عين شمس"), a("El Marg", "المرج"),
    a("Mokattam", "المقطم"), a("Helwan", "حلوان"), a("El Salam", "السلام"), a("El Rehab", "الرحاب"), a("Madinaty", "مدينتي"), a("El Shorouk", "الشروق"),
    a("Obour", "العبور"), a("Badr City", "مدينة بدر"), a("Abbasiya", "العباسية"), a("Hadayek El Kobba", "حدائق القبة"), a("Zeitoun", "الزيتون"), a("El Matareya", "المطرية"),
    a("Dar El Salam", "دار السلام"), a("El Basatin", "البساتين"), a("Old Cairo", "مصر القديمة"), a("Garden City", "جاردن سيتي"), a("Manial", "المنيل"), a("Sayeda Zeinab", "السيدة زينب"),
    a("Abdeen", "عابدين"), a("Bulaq", "بولاق"), a("Rod El Farag", "روض الفرج"), a("El Sahel", "الساحل"), a("Hadayek El Ahram", "حدائق الأهرام"), a("New Capital", "العاصمة الإدارية"),
  ] },
  { code: "GZ", en: "Giza", ar: "الجيزة", courier: "Giza", areas: [
    a("Dokki", "الدقي"), a("Mohandessin", "المهندسين"), a("Agouza", "العجوزة"), a("Haram", "الهرم"), a("Faisal", "فيصل"), a("Imbaba", "إمبابة"),
    a("6th of October", "السادس من أكتوبر", "october", "اكتوبر", "6 october"), a("Sheikh Zayed", "الشيخ زايد", "zayed"), a("Hadayek October", "حدائق أكتوبر"), a("Haram City", "هرم سيتي"),
    a("Omraneya", "العمرانية"), a("Bulaq El Dakrour", "بولاق الدكرور"), a("Warraq", "الوراق"), a("Kerdasa", "كرداسة"), a("Abu Rawash", "أبو رواش"), a("Badrashin", "البدرشين"),
    a("Hawamdeya", "الحوامدية"), a("Ayat", "العياط"), a("Saft El Laban", "صفط اللبن"), a("Manial Shiha", "منيل شيحة"),
  ] },
  { code: "ALX", en: "Alexandria", ar: "الإسكندرية", courier: "Alexandria", areas: [
    a("Smouha", "سموحة"), a("Sidi Gaber", "سيدي جابر"), a("Stanley", "ستانلي"), a("Miami", "ميامي"), a("Mandara", "المندرة"), a("Montaza", "المنتزه"),
    a("Sporting", "سبورتنج"), a("Cleopatra", "كليوباترا"), a("Roushdy", "رشدي"), a("Gleem", "جليم"), a("Loran", "لوران"), a("Sidi Bishr", "سيدي بشر"),
    a("Agami", "العجمي"), a("Borg El Arab", "برج العرب"), a("Amreya", "العامرية"), a("Moharam Bek", "محرم بك"), a("Mansheya", "المنشية"), a("Anfoushi", "الأنفوشي"),
    a("Abu Qir", "أبو قير"), a("Asafra", "العصافرة"), a("Victoria", "فيكتوريا"), a("Kafr Abdo", "كفر عبده"),
  ] },
  { code: "KB", en: "Qalyubia", ar: "القليوبية", courier: "Qalyubia", areas: [a("Banha", "بنها"), a("Shubra El Kheima", "شبرا الخيمة"), a("Qalyub", "قليوب"), a("El Khanka", "الخانكة"), a("Kafr Shukr", "كفر شكر"), a("Toukh", "طوخ"), a("Qaha", "قها"), a("Shibin El Qanater", "شبين القناطر"), a("El Qanater El Khayreya", "القناطر الخيرية")] },
  { code: "SHR", en: "Sharqia", ar: "الشرقية", courier: "Sharqia", areas: [a("Zagazig", "الزقازيق"), a("10th of Ramadan", "العاشر من رمضان", "العاشر"), a("Belbeis", "بلبيس"), a("Minya El Qamh", "منيا القمح"), a("Abu Hammad", "أبو حماد"), a("Faqous", "فاقوس"), a("Hehya", "ههيا"), a("Abu Kebir", "أبو كبير")] },
  { code: "DK", en: "Dakahlia", ar: "الدقهلية", courier: "Dakahlia", areas: [a("Mansoura", "المنصورة"), a("Talkha", "طلخا"), a("Mit Ghamr", "ميت غمر"), a("Aga", "أجا"), a("Sherbin", "شربين"), a("Belqas", "بلقاس"), a("Senbellawein", "السنبلاوين"), a("Dekernes", "دكرنس")] },
  { code: "GH", en: "Gharbia", ar: "الغربية", courier: "Gharbia", areas: [a("Tanta", "طنطا"), a("El Mahalla El Kubra", "المحلة الكبرى", "mahalla"), a("Kafr El Zayat", "كفر الزيات"), a("Zefta", "زفتى"), a("Samanoud", "سمنود"), a("Santa", "السنطة"), a("Basyoun", "بسيون")] },
  { code: "MNF", en: "Menofia", ar: "المنوفية", courier: "Menofia", areas: [a("Shibin El Kom", "شبين الكوم"), a("Sadat City", "مدينة السادات"), a("Menouf", "منوف"), a("Ashmoun", "أشمون"), a("Quesna", "قويسنا"), a("Tala", "تلا"), a("Berket El Sab", "بركة السبع")] },
  { code: "BH", en: "Beheira", ar: "البحيرة", courier: "Behira", areas: [a("Damanhour", "دمنهور"), a("Kafr El Dawar", "كفر الدوار"), a("Rashid", "رشيد", "rosetta"), a("Edku", "إدكو"), a("Abu Hommos", "أبو حمص"), a("Kom Hamada", "كوم حمادة"), a("Wadi El Natrun", "وادي النطرون")] },
  { code: "KFS", en: "Kafr El Sheikh", ar: "كفر الشيخ", also: ["Kafr Alsheikh", "Kafr Elsheikh"], areas: [a("Kafr El Sheikh", "كفر الشيخ"), a("Desouk", "دسوق"), a("Baltim", "بلطيم"), a("Fuwwah", "فوه"), a("Sidi Salem", "سيدي سالم"), a("Qallin", "قلين")] },
  { code: "DT", en: "Damietta", ar: "دمياط", areas: [a("Damietta", "دمياط"), a("New Damietta", "دمياط الجديدة"), a("Ras El Bar", "رأس البر"), a("Faraskour", "فارسكور"), a("Kafr Saad", "كفر سعد"), a("Ezbet El Borg", "عزبة البرج")] },
  { code: "PTS", en: "Port Said", ar: "بورسعيد", courier: "Port Said", areas: [a("Port Said", "بورسعيد"), a("Port Fouad", "بور فؤاد"), a("El Arab", "حي العرب"), a("El Zohour", "الزهور")] },
  { code: "IS", en: "Ismailia", ar: "الإسماعيلية", courier: "Ismailia", areas: [a("Ismailia", "الإسماعيلية"), a("Fayed", "فايد"), a("El Qantara", "القنطرة"), a("Abu Suwir", "أبو صوير"), a("El Tal El Kebir", "التل الكبير")] },
  { code: "SUZ", en: "Suez", ar: "السويس", courier: "Suez", areas: [a("Suez", "السويس"), a("El Arbaeen", "الأربعين"), a("Faisal", "فيصل السويس"), a("Ataqa", "عتاقة"), a("Ain Sokhna", "العين السخنة")] },
  { code: "FYM", en: "Faiyum", ar: "الفيوم", also: ["Fayoum", "Fayum"], areas: [a("Faiyum", "الفيوم", "fayoum"), a("Ibsheway", "إبشواي"), a("Tamiya", "طامية"), a("Sinnuris", "سنورس"), a("Itsa", "إطسا")] },
  { code: "BNS", en: "Beni Suef", ar: "بني سويف", also: ["Bani Suef", "Bani Sweif"], areas: [a("Beni Suef", "بني سويف"), a("New Beni Suef", "بني سويف الجديدة"), a("El Wasta", "الواسطى"), a("Nasser", "ناصر"), a("Biba", "ببا"), a("El Fashn", "الفشن")] },
  { code: "MN", en: "Minya", ar: "المنيا", also: ["Menya", "El Minya"], areas: [a("Minya", "المنيا"), a("New Minya", "المنيا الجديدة"), a("Mallawi", "ملوي"), a("Samalut", "سمالوط"), a("Beni Mazar", "بني مزار"), a("Maghagha", "مغاغة"), a("Abu Qurqas", "أبو قرقاص")] },
  { code: "AST", en: "Asyut", ar: "أسيوط", courier: "Assiut", areas: [a("Asyut", "أسيوط", "assiut"), a("New Asyut", "أسيوط الجديدة"), a("Dayrout", "ديروط"), a("Manfalut", "منفلوط"), a("Abnub", "أبنوب"), a("Abu Tig", "أبوتيج")] },
  { code: "SHG", en: "Sohag", ar: "سوهاج", courier: "Sohag", areas: [a("Sohag", "سوهاج"), a("Akhmim", "أخميم"), a("Girga", "جرجا"), a("Tahta", "طهطا"), a("El Maragha", "المراغة"), a("El Balyana", "البلينا")] },
  { code: "KN", en: "Qena", ar: "قنا", areas: [a("Qena", "قنا"), a("Nag Hammadi", "نجع حمادي"), a("Qus", "قوص"), a("Deshna", "دشنا"), a("Farshut", "فرشوط")] },
  { code: "LX", en: "Luxor", ar: "الأقصر", courier: "Luxor", areas: [a("Luxor", "الأقصر"), a("Esna", "إسنا"), a("Armant", "أرمنت"), a("El Bayadeya", "البياضية")] },
  { code: "ASN", en: "Aswan", ar: "أسوان", courier: "Aswan", areas: [a("Aswan", "أسوان"), a("Edfu", "إدفو"), a("Kom Ombo", "كوم أمبو"), a("Daraw", "دراو"), a("Abu Simbel", "أبو سمبل")] },
  { code: "BA", en: "Red Sea", ar: "البحر الأحمر", courier: "Red Sea", areas: [a("Hurghada", "الغردقة"), a("Safaga", "سفاجا"), a("El Quseir", "القصير"), a("Marsa Alam", "مرسى علم"), a("Ras Gharib", "رأس غارب"), a("El Gouna", "الجونة")] },
  { code: "WAD", en: "New Valley", ar: "الوادي الجديد", areas: [a("Kharga", "الخارجة"), a("Dakhla", "الداخلة"), a("Farafra", "الفرافرة"), a("Paris", "باريس")] },
  { code: "MT", en: "Matrouh", ar: "مطروح", also: ["Marsa Matrouh", "Matruh"], areas: [a("Marsa Matrouh", "مرسى مطروح"), a("El Alamein", "العلمين"), a("North Coast", "الساحل الشمالي", "sahel"), a("El Dabaa", "الضبعة"), a("Siwa", "سيوة"), a("Sidi Barrani", "سيدي براني")] },
  { code: "SIN", en: "North Sinai", ar: "شمال سيناء", areas: [a("Arish", "العريش"), a("Bir El Abd", "بئر العبد"), a("Sheikh Zuweid", "الشيخ زويد"), a("Rafah", "رفح")] },
  { code: "JS", en: "South Sinai", ar: "جنوب سيناء", areas: [a("Sharm El Sheikh", "شرم الشيخ"), a("Dahab", "دهب"), a("Nuweiba", "نويبع"), a("Taba", "طابا"), a("El Tor", "الطور"), a("Saint Catherine", "سانت كاترين")] },
];

export const SA_REGIONS: readonly Region[] = [
  { code: "01", en: "Riyadh", ar: "الرياض", areas: [a("Riyadh", "الرياض"), a("Al Kharj", "الخرج"), a("Diriyah", "الدرعية"), a("Al Majmaah", "المجمعة"), a("Dawadmi", "الدوادمي")] },
  { code: "02", en: "Makkah", ar: "مكة المكرمة", areas: [a("Jeddah", "جدة"), a("Makkah", "مكة"), a("Taif", "الطائف"), a("Rabigh", "رابغ"), a("Al Qunfudhah", "القنفذة")] },
  { code: "03", en: "Madinah", ar: "المدينة المنورة", areas: [a("Madinah", "المدينة"), a("Yanbu", "ينبع"), a("Al Ula", "العلا"), a("Badr", "بدر")] },
  { code: "04", en: "Eastern Province", ar: "المنطقة الشرقية", areas: [a("Dammam", "الدمام"), a("Khobar", "الخبر"), a("Dhahran", "الظهران"), a("Al Ahsa", "الأحساء"), a("Jubail", "الجبيل"), a("Qatif", "القطيف"), a("Hafar Al Batin", "حفر الباطن")] },
  { code: "05", en: "Al Qassim", ar: "القصيم", areas: [a("Buraidah", "بريدة"), a("Unaizah", "عنيزة"), a("Ar Rass", "الرس")] },
  { code: "06", en: "Hail", ar: "حائل", areas: [a("Hail", "حائل")] },
  { code: "07", en: "Tabuk", ar: "تبوك", areas: [a("Tabuk", "تبوك"), a("NEOM", "نيوم")] },
  { code: "08", en: "Northern Borders", ar: "الحدود الشمالية", areas: [a("Arar", "عرعر"), a("Rafha", "رفحاء")] },
  { code: "09", en: "Jazan", ar: "جازان", areas: [a("Jazan", "جازان"), a("Sabya", "صبيا"), a("Abu Arish", "أبو عريش")] },
  { code: "10", en: "Najran", ar: "نجران", areas: [a("Najran", "نجران"), a("Sharurah", "شرورة")] },
  { code: "11", en: "Al Bahah", ar: "الباحة", areas: [a("Al Bahah", "الباحة")] },
  { code: "12", en: "Al Jawf", ar: "الجوف", areas: [a("Sakaka", "سكاكا"), a("Dumat Al Jandal", "دومة الجندل")] },
  { code: "14", en: "Asir", ar: "عسير", areas: [a("Abha", "أبها"), a("Khamis Mushait", "خميس مشيط"), a("Bisha", "بيشة")] },
];

export const AE_EMIRATES: readonly Region[] = [
  { code: "DU", en: "Dubai", ar: "دبي", areas: [a("Deira", "ديرة"), a("Bur Dubai", "بر دبي"), a("Dubai Marina", "دبي مارينا"), a("Jumeirah", "جميرا"), a("Downtown Dubai", "وسط دبي"), a("Al Barsha", "البرشاء"), a("JLT", "أبراج بحيرات جميرا"), a("Business Bay", "الخليج التجاري"), a("Al Quoz", "القوز"), a("Mirdif", "مردف")] },
  { code: "AZ", en: "Abu Dhabi", ar: "أبوظبي", areas: [a("Abu Dhabi", "أبوظبي"), a("Al Ain", "العين"), a("Khalifa City", "مدينة خليفة"), a("Mussafah", "مصفح"), a("Yas Island", "جزيرة ياس"), a("Al Reem", "جزيرة الريم")] },
  { code: "SH", en: "Sharjah", ar: "الشارقة", areas: [a("Sharjah", "الشارقة"), a("Al Nahda", "النهضة"), a("Al Majaz", "المجاز"), a("Khor Fakkan", "خورفكان")] },
  { code: "AJ", en: "Ajman", ar: "عجمان", areas: [a("Ajman", "عجمان")] },
  { code: "UQ", en: "Umm Al Quwain", ar: "أم القيوين", areas: [a("Umm Al Quwain", "أم القيوين")] },
  { code: "RK", en: "Ras Al Khaimah", ar: "رأس الخيمة", areas: [a("Ras Al Khaimah", "رأس الخيمة")] },
  { code: "FU", en: "Fujairah", ar: "الفجيرة", areas: [a("Fujairah", "الفجيرة"), a("Dibba", "دبا")] },
];

const BY_COUNTRY: Readonly<Record<string, readonly Region[]>> = { EG: EG_GOVERNORATES, SA: SA_REGIONS, AE: AE_EMIRATES };

/** The regions people choose from in this country (empty for one Mizan has no list for: free text). */
export function regionsOf(country: string | null | undefined): readonly Region[] {
  return BY_COUNTRY[(country ?? "").toUpperCase()] ?? [];
}

/** For matching what people type: Arabic letter forms and diacritics folded, "governorate"/"محافظة" and the like dropped. */
export function placeKey(s: string | null | undefined): string {
  if (!s) return "";
  return s.normalize("NFKD").replace(/[ً-ْٰ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .toLowerCase().replace(/[̀-ͯ]/g, "")
    .replace(/\b(governorate|gov\.?|city|district|province|region|emirate|markaz|el|al)\b|محافظه|مدينه|مركز|منطقه|امارة|اماره/g, " ")
    .replace(/[^a-z0-9؀-ۿ]+/g, " ").trim().replace(/\s+/g, " ");
}

const keysOf = (x: { en: string; ar: string; also?: readonly string[] }) => [x.en, x.ar, ...(x.also ?? [])].map(placeKey);

/** The region a name belongs to: the region itself, or one of its areas ("Sheraton" → Cairo). */
export function findRegion(country: string | null | undefined, ...texts: Array<string | null | undefined>): Region | null {
  const regions = regionsOf(country);
  for (const text of texts) {
    const k = placeKey(text);
    if (!k) continue;
    const exact = regions.find((r) => keysOf(r).includes(k)) ?? regions.find((r) => r.areas.some((x) => keysOf(x).includes(k)));
    if (exact) return exact;
  }
  return null;
}

/** The area a text names (any spelling, Arabic or English), with its region: "شيراتون" is Sheraton, Cairo. */
export function findArea(country: string | null | undefined, text: string | null | undefined): { region: Region; area: Area } | null {
  const k = placeKey(text);
  if (!k) return null;
  for (const region of regionsOf(country)) {
    const area = region.areas.find((x) => keysOf(x).includes(k));
    if (area) return { region, area };
  }
  return null;
}

/** Areas of a region matching what is typed (start of a word first), for the area picker. */
export function searchAreas(region: Region | null, text: string, limit = 8): Area[] {
  if (!region) return [];
  const k = placeKey(text);
  if (!k) return region.areas.slice(0, limit);
  const starts = region.areas.filter((x) => keysOf(x).some((n) => n.startsWith(k) || n.split(" ").some((w) => w.startsWith(k))));
  const contains = region.areas.filter((x) => !starts.includes(x) && keysOf(x).some((n) => n.includes(k)));
  return [...starts, ...contains].slice(0, limit);
}

/**
 * A location from what people paste: a Google Maps link (…/@30.06,31.33,… or ?q=30.06,31.33),
 * or "30.06, 31.33". Null when it holds no coordinates (a short maps.app.goo.gl link needs opening first).
 */
export function parseLocation(text: string | null | undefined): { lat: number; lng: number } | null {
  if (!text) return null;
  const t = text.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/٫/g, ".").replace(/،/g, ",");
  const m = /@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/.exec(t)
    ?? /[?&](?:q|query|ll|destination)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/.exec(t)
    ?? /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/.exec(t)
    ?? /^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/.exec(t);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 } : null;
}
