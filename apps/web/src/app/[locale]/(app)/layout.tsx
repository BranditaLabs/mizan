import { setRequestLocale } from "next-intl/server";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { StoreGate } from "@/components/auth/Gate";
import { Shell } from "@/components/Shell";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";

/** Every store page: signed in, in a store the API accepts (StoreGate), inside the app frame. */
export default async function AppLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <StoreGate>
      <Shell theme={theme}>{children}</Shell>
    </StoreGate>
  );
}
