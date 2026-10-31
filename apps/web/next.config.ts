import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

/** API origin the browser may call; the dashboard itself serves no data. */
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
/** Firebase Auth: Identity Toolkit and Secure Token (*.googleapis.com), or the emulator in development and tests. */
const authEmulator = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL ?? "";
/** Invisible reCAPTCHA that Firebase runs before it sends an SMS code (not loaded against the emulator). */
const recaptcha = "https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/";

const csp = [
  "default-src 'self'",
  // Next injects inline bootstrap scripts; nonce-based CSP comes with E4-2 if needed.
  `script-src 'self' 'unsafe-inline' ${recaptcha}` + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "manifest-src 'self'",
  `connect-src 'self' ${api} https://identitytoolkit.googleapis.com https://securetoken.googleapis.com ${authEmulator}`.trimEnd(),
  "frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const config: NextConfig = {
  // Self-contained server for the Cloud Run `web` image (docs/09); `next start` (dev, tests) needs the default output.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@mizan/shared", "@mizan/design-system"],
  // The legal pages read their Markdown at render time (L1-3): ship it with the standalone server.
  outputFileTracingIncludes: { "/[locale]/legal/[doc]": ["./content/legal/**"] },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};

export default createNextIntlPlugin("./src/i18n/request.ts")(config);
