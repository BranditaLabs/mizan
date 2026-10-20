import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

/** API origin the browser may call (E4-4); the dashboard itself serves no data. */
const api = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

const csp = [
  "default-src 'self'",
  // Next injects inline bootstrap scripts; nonce-based CSP comes with E4-2 if needed.
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${api} https://*.googleapis.com https://*.firebaseapp.com`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const config: NextConfig = {
  // Self-contained server for the Cloud Run `web` image (docs/09); `next start` (dev, tests) needs the default output.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@mizan/shared"],
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
