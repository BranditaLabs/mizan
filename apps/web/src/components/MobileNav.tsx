"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { activeKey, navFor, primaryFor } from "@/lib/nav";
import { useSession } from "@/lib/session";
import { NavLinks } from "./NavLinks";
import { StoreSwitcher } from "./StoreSwitcher";
import { Drawer } from "./ui/Dialog";
import { cx } from "./ui/logic";

/**
 * Below laptop width the rail is hidden (U3): a bar at the bottom with the four places this role
 * uses most, and "More" for everything else, the store and its switcher. Before this, phones and
 * tablets had no way to move between sections.
 */
export function MobileNav() {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const { store } = useSession();
  // The sheet belongs to the page it was opened on: a new page (a link in it, a store switch, the back button) closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const more = openOn === pathname;
  const setMore = (open: boolean) => setOpenOn(open ? pathname : null);
  if (!store) return null;
  const primary = primaryFor(store.role);
  const current = activeKey(navFor(store.role), pathname);
  const inMore = current !== null && !primary.some((p) => p.key === current);
  const cell = "flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md py-1.5 text-caption leading-none";
  return (
    <>
      <nav aria-label={t("mobileNav")} data-testid="mobile-nav"
        className="g fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom,0px))] z-30 flex h-16 items-stretch gap-1 px-2 lg:hidden print:hidden">
        {primary.map((n) => (
          <Link key={n.key} href={n.href} aria-current={n.key === current ? "page" : undefined}
            className={cx(cell, n.key === current ? "bg-surface-hover text-text" : "text-text-2")}>
            <Icon name={n.icon} size={20} />
            <span className="max-w-full truncate">{t(`nav.${n.key}`)}</span>
          </Link>
        ))}
        <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog" aria-expanded={more}
          className={cx(cell, inMore ? "bg-surface-hover text-text" : "text-text-2")}>
          <Icon name="menu" size={20} />
          <span>{t("more")}</span>
        </button>
      </nav>
      <Drawer open={more} onClose={() => setMore(false)} title={t("more")}>
        <div className="flex flex-col gap-5">
          <StoreSwitcher />
          <NavLinks onNavigate={() => setMore(false)} />
        </div>
      </Drawer>
    </>
  );
}
