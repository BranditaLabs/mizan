"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { useSession } from "@/lib/session";
import { chooseTheme, THEMES } from "@/lib/theme";
import { CommandPalette, useCommandPalette, type Command } from "./ui/CommandPalette";

const noop = () => () => {};
const SHORTCUT = { mac: "⌘K", other: "Ctrl K" } as const;
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Header search button + the ⌘K palette: pages, theme, language, stores, sign-out. */
export function ShellCommands() {
  const t = useTranslations("ui.palette");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const { stores, store, selectStore, signOut } = useSession();
  const { open, setOpen } = useCommandPalette();
  const mac = useSyncExternalStore(noop, isMac, () => true);

  const commands = useMemo<Command[]>(() => [
    { id: "go-home", group: t("groups.navigate"), label: t("commands.home"), icon: "home", run: () => router.push("/") },
    ...stores.filter((s) => s.tenantId !== store?.tenantId).map((s): Command => ({
      id: `store-${s.tenantId}`, group: t("groups.stores"), label: t("commands.store", { store: s.tenantName }), icon: "channels", run: () => selectStore(s.tenantId),
    })),
    ...THEMES.map((th): Command => ({
      id: `theme-${th}`, group: t("groups.preferences"), label: t(`commands.theme.${th}`), icon: th === "light" ? "theme-light" : th === "dark" ? "theme-dark" : "device", run: () => chooseTheme(th),
    })),
    ...routing.locales.filter((l) => l !== locale).map((l): Command => ({
      id: `lang-${l}`, group: t("groups.preferences"), label: t(`commands.language.${l}`), icon: "language", keywords: "language لغة", run: () => router.replace(pathname, { locale: l }),
    })),
    { id: "sign-out", group: t("groups.account"), label: t("commands.signOut"), icon: "logout", run: () => void signOut() },
  ], [t, router, pathname, locale, stores, store, selectStore, signOut]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
        className="mz-input inline-flex w-auto min-w-0 items-center gap-2 text-text-3 md:w-72">
        <Icon name="search" size={16} />
        <span className="hidden flex-1 truncate text-start md:inline">{t("open")}</span>
        <span className="sr-only md:hidden">{t("open")}</span>
        <kbd className="mz-kbd hidden md:inline" dir="ltr">{mac ? SHORTCUT.mac : SHORTCUT.other}</kbd>
      </button>
      <CommandPalette open={open} onClose={() => setOpen(false)} commands={commands} />
    </>
  );
}
