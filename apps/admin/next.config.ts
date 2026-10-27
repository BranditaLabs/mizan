import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

/** API origin the browser may call; the back office serves no data itself. */
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const authEmulator = process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_URL ?? "";
const recaptcha = "https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${recaptcha}` + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${api} https://identitytoolkit.googleapis.com https://securetoken.googleapis.com ${authEmulator}`.trimEnd(),
  "frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const config: NextConfig = {
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@mizan/shared", "@mizan/design-system"],
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: csp },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Robots-Tag", value: "noindex, nofollow" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    }];
  },
};

export default createNextIntlPlugin("./src/i18n/request.ts")(config);
