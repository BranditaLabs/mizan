"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { Link } from "@/i18n/navigation";
import { useSession } from "@/lib/session";

/**
 * The store you are working in, on the ink rail (`rail`) or in the mobile header. More than one
 * store: a native select (keyboard and screen readers for free; the UI kit's combobox comes in E4-3).
 */
export function StoreSwitcher({ rail = false }: { rail?: boolean }) {
  const t = useTranslations("shell.store");
  const tr = useTranslations("roles");
  const { stores, store, selectStore } = useSession();
  const id = useId();
  if (!store) return null;
  const muted = rail ? "text-rail-text-2" : "text-text-3";
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className={`text-overline uppercase ${muted} ${rail ? "" : "sr-only"}`}>{t("label")}</label>
      {stores.length > 1 ? (
        <select id={id} value={store.tenantId} onChange={(e) => selectStore(e.target.value)} title={t("switch")} data-testid="store-switcher"
          className={`h-9 min-w-0 truncate rounded-sm border px-2.5 text-label ${rail ? "border-rail-line bg-rail-surface text-text" : "border-line-strong bg-surface text-text"}`}>
          {stores.map((s) => <option key={s.tenantId} value={s.tenantId}>{s.tenantName}</option>)}
        </select>
      ) : (
        <output id={id} data-testid="store-switcher" className="truncate text-label text-text">{store.tenantName}</output>
      )}
      {rail ? (
        <div className="flex items-center justify-between gap-2">
          <span className={`text-caption ${muted}`} data-testid="store-role">{tr(store.role)}</span>
          <Link href="/welcome" className={`inline-flex items-center gap-1 text-caption ${muted} hover:text-text`}>
            <Icon name="add" size={14} />
            {t("create")}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

/** Who is signed in, and sign out (header). */
export function UserMenu() {
  const t = useTranslations("shell");
  const { me, signOut } = useSession();
  const who = me?.user.displayName ?? me?.user.email ?? me?.user.phone ?? "";
  return (
    <div className="flex min-w-0 items-center gap-2">
      <bdi className="hidden max-w-[22ch] truncate text-body-sm text-text-2 md:block" data-testid="user-id">{who}</bdi>
      <button type="button" onClick={() => void signOut()} title={t("signOut")}
        className="inline-flex h-8 items-center gap-1.5 rounded-sm px-2 text-label text-text-2 hover:bg-surface-hover hover:text-text">
        <Icon name="logout" size={16} />
        <span className="sr-only sm:not-sr-only">{t("signOut")}</span>
      </button>
    </div>
  );
}
