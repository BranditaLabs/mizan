import { setRequestLocale } from "next-intl/server";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AuthShell } from "@/components/auth/Frame";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";

/**
 * The screens before a store (sign-in, welcome, two-step) share one persistent frame: moving
 * between them changes the card's content and the stage's scene, never the frame (auth spec §1.1).
 * URLs are unchanged; `(auth)` is a route group.
 */
export default async function AuthLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return <AuthShell theme={theme}>{children}</AuthShell>;
}
