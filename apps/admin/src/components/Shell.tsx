"use client";

import { useTranslations } from "next-intl";
import { useEffect, type ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import type { StaffRole } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { Wordmark } from "./Wordmark";

/** Each page and who may open it (the API checks again). */
export const NAV: ReadonlyArray<{ href: string; key: string; roles?: StaffRole[] }> = [
  { href: "/stores", key: "stores" },
  { href: "/access", key: "access", roles: ["super_admin", "support", "engineer"] },
  { href: "/health", key: "health", roles: ["super_admin", "engineer"] },
  { href: "/users", key: "users", roles: ["super_admin", "support", "engineer"] },
  { href: "/flags", key: "flags", roles: ["super_admin", "engineer", "support"] },
  { href: "/announcements", key: "announcements", roles: ["super_admin", "support", "engineer"] },
  { href: "/staff", key: "staff", roles: ["super_admin"] },
  { href: "/audit", key: "audit", roles: ["super_admin", "engineer"] },
];

/**
 * The staff gate and frame: signed out → sign-in; signed in but refused by the API (no second
 * factor, not staff, disabled) → why, and a way out; staff → the navigation and the page.
 */
export function Shell({ children }: { children: ReactNode }) {
  const t = useTranslations("shell");
  const router = useRouter();
  const pathname = usePathname();
  const { status, check, staff, user, can, retry, signOut } = useSession();

  useEffect(() => {
    if (status === "signed-out") router.replace("/sign-in");
  }, [status, router]);

  if (status !== "signed-in" || check === "checking" || check === "idle") {
    return <p role="status" className="p-8 text-center text-body-sm text-text-2">{t("loading")}</p>;
  }
  if (check !== "ok") {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-4">
        <Wordmark />
        <Alert tone={check === "unavailable" ? "warning" : "danger"}>{t(`refused.${check}`)}</Alert>
        <div className="flex gap-2">
          {check === "unavailable" ? <Button onClick={retry}>{t("retry")}</Button> : null}
          <Button variant="secondary" onClick={() => void signOut()}>{t("signOut")}</Button>
        </div>
      </main>
    );
  }
  const items = NAV.filter((n) => !n.roles || can(...n.roles));
  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <aside className="border-b border-line bg-surface px-4 py-3 md:w-56 md:shrink-0 md:border-b-0 md:border-e md:py-5">
        <div className="flex items-center justify-between gap-2 md:block">
          <Wordmark />
          <Button variant="ghost" className="md:hidden" onClick={() => void signOut()}>{t("signOut")}</Button>
        </div>
        <nav aria-label={t("navLabel")} className="mt-3 flex gap-1 overflow-x-auto md:mt-6 md:flex-col">
          {items.map((n) => {
            const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
            return (
              <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
                className={`whitespace-nowrap rounded-md px-3 py-2 text-body-sm ${active ? "bg-surface-hover font-medium text-text" : "text-text-2 hover:bg-surface-hover hover:text-text"}`}>
                {t(`nav.${n.key}`)}
              </Link>
            );
          })}
        </nav>
        <div className="mt-6 hidden text-caption text-text-2 md:block">
          <p className="truncate" dir="ltr">{user?.email}</p>
          <p>{t(`roles.${staff!.role}`)}</p>
          <Button variant="ghost" className="mt-2 px-0" onClick={() => void signOut()}>{t("signOut")}</Button>
        </div>
      </aside>
      <main id="main" className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</main>
    </div>
  );
}
