"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { ok } from "@/lib/api/client";
import { useSession } from "@/lib/session";
import { SETTINGS_GROUPS, settingsFor } from "@/lib/settings-nav";
import { cx } from "@/components/ui/logic";

/**
 * Settings (U4): a grouped side menu on wide screens with the open page beside it; on phones the
 * /settings page is the list, and each page has a way back to it. Only the pages this role can
 * open are listed. Replaces the 15-tab row every page drew for itself.
 */
export function SettingsLayout({ children }: { children: ReactNode }) {
  const t = useTranslations("settings");
  const pathname = usePathname();
  const atHome = pathname === "/settings";
  return (
    <div className="mx-auto flex max-w-[1280px] gap-8 px-4 pt-6 pb-14 md:px-6" data-testid="settings-layout">
      <aside className="hidden w-[232px] shrink-0 lg:block">
        <div className="sticky top-0 flex flex-col gap-1">
          <Link href="/settings" className={cx("mb-2 font-display text-heading-sm", atHome ? "text-text" : "text-text-2 hover:text-text")} aria-current={atHome ? "page" : undefined}>{t("label")}</Link>
          <SettingsNav />
        </div>
      </aside>
      <div className="flex min-w-0 max-w-[960px] flex-1 flex-col gap-4">
        {atHome ? null : (
          <Link href="/settings" className="inline-flex w-fit items-center gap-1.5 text-body-sm text-text-2 hover:text-text lg:hidden">
            <Icon name="back" size={16} />{t("label")}
          </Link>
        )}
        {children}
      </div>
    </div>
  );
}

/** The grouped list of settings pages for this role. */
export function SettingsNav() {
  const t = useTranslations("settings");
  const pathname = usePathname();
  const { store } = useSession();
  const pages = settingsFor(store?.role);
  return (
    <nav aria-label={t("label")} className="flex flex-col gap-4">
      {SETTINGS_GROUPS.map((g) => {
        const mine = pages.filter((p) => p.group === g);
        if (!mine.length) return null;
        return (
          <div key={g} className="flex flex-col gap-0.5">
            <h2 className="px-2.5 pb-1 text-overline uppercase text-text-3">{t(`groups.${g}`)}</h2>
            {mine.map((p) => {
              const on = pathname === p.href || pathname.startsWith(`${p.href}/`);
              return (
                <Link key={p.key} href={p.href} aria-current={on ? "page" : undefined}
                  className={cx("flex items-center gap-2.5 rounded-md px-2.5 py-2 text-body-sm", on ? "bg-surface-hover font-medium text-text" : "text-text-2 hover:bg-surface-hover hover:text-text")}>
                  <Icon name={p.icon} size={16} />{t(`pages.${p.key}`)}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}

/**
 * /settings: what needs the owner first (a store or courier connection asking for attention),
 * then every page this role can open, by group, each saying what it is for.
 */
export function SettingsHome() {
  const t = useTranslations("settings");
  const { api, user, store } = useSession();
  const pages = settingsFor(store?.role);
  const canSeeConnections = pages.some((p) => p.key === "integrations");
  const connections = useQuery({
    queryKey: ["connections", user?.uid ?? "", store?.tenantId ?? ""],
    queryFn: () => ok(api.GET("/v1/connections")),
    enabled: Boolean(store) && canSeeConnections,
    meta: { toast: false },
  });
  const attention = (connections.data?.data ?? []).filter((c) => c.status === "needs_attention");
  return (
    <div className="flex flex-col gap-6" data-testid="settings-home">
      <header>
        <h1 className="font-display text-heading-lg">{t("label")}</h1>
        <p className="mt-1 max-w-[70ch] text-body-sm text-text-2">{t("subtitle")}</p>
      </header>
      {attention.length ? (
        <section className="mz-card flex flex-col gap-2 p-4" data-testid="settings-attention">
          <h2 className="flex items-center gap-2 text-label"><Icon name="warning" size={16} />{t("attention.title")}</h2>
          <ul className="flex flex-col gap-1 text-body-sm">
            {attention.map((c) => (
              <li key={c.id}>
                <Link href="/settings/integrations" className="hover:underline">{t("attention.connection", { provider: c.provider })}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {pages.length === 0 ? <p className="text-body-sm text-text-2">{t("none")}</p> : null}
      {SETTINGS_GROUPS.map((g) => {
        const mine = pages.filter((p) => p.group === g);
        if (!mine.length) return null;
        return (
          <section key={g} className="flex flex-col gap-2">
            <h2 className="text-overline uppercase text-text-3">{t(`groups.${g}`)}</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {mine.map((p) => (
                <Link key={p.key} href={p.href} className="mz-card flex items-start gap-3 p-4 hover:bg-surface-hover">
                  <Icon name={p.icon} size={20} className="mt-0.5 text-text-2" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-label">{t(`pages.${p.key}`)}</span>
                    <span className="text-body-sm text-text-2">{t(`about.${p.key}`)}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
