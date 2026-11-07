import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noPhysicalDirection from "../web/eslint-rules/no-physical-direction.js";
import noAdhocMotion from "../web/eslint-rules/no-adhoc-motion.js";
import noBrandRed from "../web/eslint-rules/no-brand-red.js";

/** The dashboard's rules (apps/web): Next's recommended set plus Mizan's bilingual rules (docs/08 §3). */
const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: [".next/**", "playwright-report/**", "test-results/**", "next-env.d.ts"] },
  {
    plugins: { mizan: { rules: { "no-physical-direction": noPhysicalDirection, "no-adhoc-motion": noAdhocMotion, "no-brand-red": noBrandRed } } },
    rules: {
      "mizan/no-physical-direction": "error",
      // Brand 2.0: motion comes from the design system and the event-motion catalogue; only it hands out the red.
      "mizan/no-adhoc-motion": "error",
      "mizan/no-brand-red": "error",
      "react/jsx-no-literals": ["error", { noStrings: true, ignoreProps: true, allowedStrings: ["·", "—", "/", "%", "+", "−", ":", "#"] }],
    },
  },
  { files: ["test/**", "e2e/**", "*.config.*"], rules: { "react/jsx-no-literals": "off", "mizan/no-adhoc-motion": "off", "mizan/no-brand-red": "off" } },
];

export default config;
