import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noPhysicalDirection from "./eslint-rules/no-physical-direction.js";

/** Next's recommended rules plus Mizan's bilingual rules (docs/08 §3). */
const config = [
  ...nextVitals,
  ...nextTs,
  { ignores: [".next/**", "playwright-report/**", "test-results/**", "next-env.d.ts"] },
  {
    plugins: { mizan: { rules: { "no-physical-direction": noPhysicalDirection } } },
    rules: {
      "mizan/no-physical-direction": "error",
      // Every user-facing string comes from messages/{ar,en}.json.
      "react/jsx-no-literals": ["error", { noStrings: true, ignoreProps: true, allowedStrings: ["·", "—", "/", "%", "+", "−", ":", "#"] }],
    },
  },
  { files: ["test/**", "e2e/**", "eslint-rules/**", "*.config.*"], rules: { "react/jsx-no-literals": "off" } },
];

export default config;
