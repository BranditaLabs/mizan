import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noPhysicalDirection from "./eslint-rules/no-physical-direction.js";
import noAdhocMotion from "./eslint-rules/no-adhoc-motion.js";
import noBrandRed from "./eslint-rules/no-brand-red.js";
import noUnknownI18nNamespace from "./eslint-rules/no-unknown-i18n-namespace.js";
import busyNeedsMeaning, { silentWrite } from "./eslint-rules/busy-needs-meaning.js";

/** Next's recommended rules plus Mizan's bilingual rules (docs/08 §3). */
const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: [".next/**", "playwright-report/**", "test-results/**", "next-env.d.ts"] },
  {
    plugins: { mizan: { rules: { "no-physical-direction": noPhysicalDirection, "no-unknown-i18n-namespace": noUnknownI18nNamespace, "no-adhoc-motion": noAdhocMotion, "no-brand-red": noBrandRed, "busy-needs-meaning": busyNeedsMeaning, "silent-write": silentWrite } } },
    rules: {
      "mizan/no-physical-direction": "error",
      "mizan/no-unknown-i18n-namespace": "error",
      // Brand 2.0: motion comes from the design system and the event-motion catalogue; only it hands out the red.
      "mizan/no-adhoc-motion": "error",
      "mizan/no-brand-red": "error",
      // A busy control names what the press does (loading, signing in, checking, syncing, sending, saving, creating), never a default.
      "mizan/busy-needs-meaning": "error",
      "mizan/silent-write": "warn",
      // Every user-facing string comes from messages/{ar,en}.json.
      "react/jsx-no-literals": ["error", { noStrings: true, ignoreProps: true, allowedStrings: ["·", "—", "/", "%", "+", "−", ":", "#", "~"] }],
    },
  },
  { files: ["test/**", "e2e/**", "eslint-rules/**", "*.config.*"], rules: { "react/jsx-no-literals": "off", "mizan/no-adhoc-motion": "off", "mizan/no-brand-red": "off", "mizan/busy-needs-meaning": "off", "mizan/silent-write": "off" } },
  // The Open Graph card is an image drawn on the server (no theme, no red budget): the brand hexes are its paint,
  // and ImageResponse draws plain <img> (next/image does not exist there).
  { files: ["src/app/**/opengraph-image.tsx"], rules: { "mizan/no-brand-red": "off", "@next/next/no-img-element": "off" } },
];

export default config;
