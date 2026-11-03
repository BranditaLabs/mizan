"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useTranslations } from "next-intl";
import { useLayoutEffect, useRef, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { activeKey, NAV_GROUPS, navFor } from "@/lib/nav";
import { useSession } from "@/lib/session";

/**
 * The main menu on Mizan Glass (docs/glass.md "Navigation"), in groups, showing only the sections
 * the person's role can open (U3; lib/nav.ts). A glass indicator slides on a spring to the open
 * section, carrying the red point at its edge. Used on the rail and in the phone's "More" sheet.
 */
export function NavLinks({ onNavigate }: { onNavigate?(): void }) {
  const t = useTranslations("shell");
  const pathname = usePathname();
  const { store } = useSession();
  const links = navFor(store?.role);
  const current = activeKey(links, pathname);
  const nav = useRef<HTMLElement>(null);
  const [top, setTop] = useState<number | null>(null);
  // The indicator sits on the open item, wherever the group labels put it; and the item is in view.
  useLayoutEffect(() => {
    const el = nav.current?.querySelector<HTMLElement>("[aria-current=page]");
    setTop(el ? el.offsetTop : null);
    el?.scrollIntoView({ block: "nearest" });
  }, [current, links.length]);

  const item = (n: (typeof links)[number]) => (
    <Link key={n.key} href={n.href} aria-current={n.key === current ? "page" : undefined} onClick={onNavigate} className="nav-item active:scale-[0.98]">
      <Icon name={n.icon} size={17} />
      {t(`nav.${n.key}`)}
    </Link>
  );
  return (
    <nav ref={nav} aria-label={t("navLabel")} className="nav" data-testid="main-nav">
      {top !== null ? <span className="nav-ind" style={{ transform: `translateY(${top}px)` }} aria-hidden="true" /> : null}
      {links.filter((n) => n.group === null && n.key === "home").map(item)}
      {NAV_GROUPS.map((g) => {
        const inGroup = links.filter((n) => n.group === g);
        if (!inGroup.length) return null;
        return (
          <div key={g} role="group" aria-label={t(`navGroups.${g}`)} className="contents">
            <span className="nav-label text-overline uppercase text-rail-text-2" aria-hidden="true">{t(`navGroups.${g}`)}</span>
            {inGroup.map(item)}
          </div>
        );
      })}
      {links.some((n) => n.group === null && n.key !== "home") ? <span className="nav-label" aria-hidden="true" /> : null}
      {links.filter((n) => n.group === null && n.key !== "home").map(item)}
    </nav>
  );
}
