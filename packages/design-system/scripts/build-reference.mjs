#!/usr/bin/env node
/** Builds reference/index.html: one self-contained page (fonts, CSS, icons and logos inlined). */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const r = (p) => readFileSync(join(root, p), "utf8");
const b64 = (p) => readFileSync(join(root, p)).toString("base64");
const T = JSON.parse(r("tokens/tokens.json"));
const M = JSON.parse(r("icons/manifest.json"));
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

const fonts = r("css/fonts.css").replace(/url\("\.\.\/fonts\/web\/([^"]+)"\)/g, (_, f) => `url("data:font/woff2;base64,${b64(`fonts/web/${f}`)}")`);
const logo = (f) => `data:image/svg+xml;base64,${b64(`logo/svg/${f}.svg`)}`;
const LOGOS = {
  wordmark: logo("mizan-wordmark"), "on-dark": logo("mizan-wordmark-on-dark"), ar: logo("mizan-wordmark-ar"), "ar-on-dark": logo("mizan-wordmark-ar-on-dark"),
  "ar-mono-white": logo("mizan-wordmark-ar-mono-white"), endorsed: logo("mizan-endorsed"), "endorsed-on-dark": logo("mizan-endorsed-on-dark"),
  "bilingual-on-dark": logo("mizan-bilingual-on-dark"), appicon: logo("mizan-appicon"), favicon: logo("mizan-favicon"),
};

const brandSw = [["ink", "Ink", "Primary actions, display type, the rail"], ["paper", "Paper", "The app canvas"], ["red", "Red", "The red point, active state, errors"], ["redHi", "Red · on dark", "Red on ink surfaces"],
  ["inkBar", "Ink bar", "Hover on ink, bars"], ["inkMute", "Mute", "Secondary text"], ["line", "Line", "Borders and dividers"], ["line2", "Line strong", "Input borders"]]
  .map(([k, n, use]) => `<div class="ds-sw"><div class="chip" style="background:${T.brand[k].$value};${k.startsWith("line") || k === "paper" ? "border-bottom:1px solid var(--mz-line)" : ""}"></div><div class="inf"><b>${n}</b><span>${T.brand[k].$value}</span><i>${use}</i></div></div>`).join("");

const semanticKeys = ["bg", "surface", "surfaceSunk", "line", "text", "text2", "text3", "primary", "brand", "brandText", "successText", "warningText", "infoText", "dangerText", "railBg"];
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([a-z])([0-9])/g, "$1-$2").toLowerCase();
const semantic = semanticKeys.map((k) => `<tr><td><code>--mz-${kebab(k)}</code></td><td><span class="ds-dot"><i style="background:${T.color.light[k].$value}"></i>${T.color.light[k].$value}</span></td><td><span class="ds-dot"><i style="background:${T.color.dark[k].$value}"></i>${T.color.dark[k].$value}</span></td><td style="color:var(--mz-text-2)">${esc(T.color.light[k].$description ?? "")}</td></tr>`).join("");

const sample = { displayXl: "Real profit", displayLg: "Every order, every method", displayMd: "Cash and payment reconciliation", headingLg: "Orders awaiting payment", headingMd: "Courier scorecard", headingSm: "Delivery rate by zone", bodyLg: "Bosta collects the 1,800 balance on delivery.", body: "Ship only orders that will be delivered and kept.", bodySm: "Synced from Shopify 2 minutes ago", label: "Customer phone", caption: "Updated 14:20 · sample data", overline: "Net profit", kpi: "186,960", kpiSm: "78.4%", mono: "#EO-48302 · BOS-77118802" };
const sampleAr = { displayXl: "الربح الحقيقي", displayLg: "كل أوردر، بكل طريقة دفع", displayMd: "تسوية الكاش والمدفوعات", headingLg: "أوردرات مستنية الدفع", headingMd: "تقييم شركات الشحن", headingSm: "نسبة التسليم لكل منطقة", bodyLg: "بوسطة هتحصّل الباقي 1,800 عند التسليم.", body: "اشحن الأوردرات اللي هتتسلم وتفضل مدفوعة بس.", bodySm: "اتزامن من شوبيفاي من دقيقتين", label: "موبايل العميل", caption: "آخر تحديث 14:20 · بيانات تجريبية", overline: "صافي الربح" };
const scale = Object.entries(T.type).filter(([k]) => !k.startsWith("$")).map(([k, t]) => `<div><code>${k}</code><span class="s mz-text-${kebab(k)}"${sampleAr[k] ? ` data-ar="${esc(sampleAr[k])}"` : ""}>${sample[k] ?? k}</span><code>${t.size}/${t.lineHeight} · ${t.weight} · ${t.tracking}em</code></div>`).join("");

const grid = M.icons.map((i) => `<div class="ds-ic${i.rtlFlip ? " flip" : ""}" data-k="${esc(`${i.name} ${i.group} ${i.en} ${i.ar}`.toLowerCase())}"><svg aria-hidden="true"><use href="#mz-${i.name}"/></svg><b>${i.name}</b><span>${esc(i.en)} · ${esc(i.ar)}</span></div>`).join("");

let html = r("reference/template.html")
  .replace("/*@@TOKENS@@*/", () => r("dist/tokens.css")).replace("/*@@FONTS@@*/", () => fonts)
  .replace("/*@@BASE@@*/", () => r("css/base.css")).replace("/*@@COMPONENTS@@*/", () => r("css/components.css"))
  .replace("<!--@@SPRITE@@-->", () => r("icons/sprite.svg"))
  .replace("/*@@LOGOS@@*/{}", () => JSON.stringify(LOGOS)).replace("/*@@VIZ@@*/{}", () => JSON.stringify(T.viz))
  .replace("@@BRANDSWATCHES@@", () => brandSw).replace("@@SEMANTIC@@", () => semantic).replace("@@SCALE@@", () => scale).replace("@@ICONGRID@@", () => grid)
  .replaceAll("@@ICONCOUNT@@", String(M.icons.length));
writeFileSync(join(root, "reference/index.html"), html);
console.log(`reference built: ${(html.length / 1024).toFixed(0)} KB`);
