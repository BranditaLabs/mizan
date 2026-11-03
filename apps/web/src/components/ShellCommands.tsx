"use client";

import { rolesWith } from "@mizan/shared";
import { Icon } from "@mizan/design-system/icons/react";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";
import { ok } from "@/lib/api/client";
import { navFor } from "@/lib/nav";
import { useSession } from "@/lib/session";
import { useSwitchStore } from "@/lib/use-switch-store";
import { chooseTheme, THEMES } from "@/lib/theme";
import { openFeedback } from "./FeedbackButton";
import { CommandPalette, useCommandPalette, type Command } from "./ui/CommandPalette";

const noop = () => () => {};
const SHORTCUT = { mac: "⌘K", other: "Ctrl K" } as const;
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const ORDER_READERS = rolesWith("orders.read");
/** Who may start each action (the same roles as the pages that do it). */
const ACTIONS = [
  { id: "new-order", href: "/orders/new", icon: "add", roles: ["owner", "admin", "ops_manager", "agent"], keywords: "new order create أوردر جديد" },
  { id: "new-product", href: "/products/new", icon: "product", roles: ["owner", "admin", "ops_manager"], keywords: "new product منتج جديد" },
  { id: "new-po", href: "/purchasing/new", icon: "purchasing", roles: ["owner", "admin", "ops_manager"], keywords: "purchase order supplier أمر شراء" },
  { id: "invite", href: "/settings/team", icon: "customer", roles: ["owner", "admin"], keywords: "invite team member employee دعوة موظف فريق" },
] as const;

/** Header search button + the ⌘K palette: every page this role can open, actions, orders by number or phone, stores, preferences. */
export function ShellCommands() {
  const t = useTranslations("ui.palette");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const tn = useTranslations("shell.nav");
  const { api, user, stores, store, signOut } = useSession();
  // Orders by number or phone, once something order-like is typed (debounced).
  const [typed, setTyped] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => { const h = setTimeout(() => setTerm(typed.trim()), 250); return () => clearTimeout(h); }, [typed]);
  const searchable = ORDER_READERS.has(store?.role ?? "") && term.replace(/[^\p{N}\p{L}]/gu, "").length >= 3;
  const found = useQuery({
    queryKey: ["paletteOrders", user?.uid ?? "", store?.tenantId ?? "", term],
    queryFn: () => ok(api.GET("/v1/orders", { params: { query: { q: term, limit: 5 } } })),
    enabled: Boolean(store) && searchable,
    meta: { toast: false },
    staleTime: 10_000,
  });
  const switchStore = useSwitchStore();
  const { open, setOpen } = useCommandPalette();
  const mac = useSyncExternalStore(noop, isMac, () => true);

  const commands = useMemo<Command[]>(() => [
    ...navFor(store?.role).map((n): Command => ({ id: `go-${n.key}`, group: t("groups.navigate"), label: tn(n.key), icon: n.icon, keywords: n.keywords, run: () => router.push(n.href) })),
    ...(store ? ACTIONS.filter((a) => (a.roles as readonly string[]).includes(store.role)) : []).map((a): Command => ({
      id: a.id, group: t("groups.actions"), label: t(`commands.${a.id}`), icon: a.icon, keywords: a.keywords, run: () => router.push(a.href),
    })),
    ...stores.filter((s) => s.tenantId !== store?.tenantId).map((s): Command => ({
      id: `store-${s.tenantId}`, group: t("groups.stores"), label: t("commands.store", { store: s.tenantName }), icon: "channels", run: () => switchStore(s.tenantId),
    })),
    ...THEMES.map((th): Command => ({
      id: `theme-${th}`, group: t("groups.preferences"), label: t(`commands.theme.${th}`), icon: th === "light" ? "theme-light" : th === "dark" ? "theme-dark" : "device", run: () => chooseTheme(th),
    })),
    ...routing.locales.filter((l) => l !== locale).map((l): Command => ({
      id: `lang-${l}`, group: t("groups.preferences"), label: t(`commands.language.${l}`), icon: "language", keywords: "language لغة", run: () => router.replace(pathname, { locale: l }),
    })),
    ...(store ? [{ id: "feedback", group: t("groups.account"), label: t("commands.feedback"), icon: "message", keywords: "feedback idea problem bug رأي فكرة مشكلة", run: openFeedback } satisfies Command] : []),
    { id: "sign-out", group: t("groups.account"), label: t("commands.signOut"), icon: "logout", run: () => void signOut() },
  ], [t, tn, router, pathname, locale, stores, store, switchStore, signOut]);
  const results = useMemo<Command[]>(() => (searchable ? found.data?.data ?? [] : []).map((o) => ({
    id: `order-${o.id}`, group: t("groups.orders"), icon: "orders",
    label: [o.number, o.customer.label, o.customer.phoneLast4 ? `•••• ${o.customer.phoneLast4}` : null].filter(Boolean).join(" · "),
    run: () => router.push(`/orders/${o.id}`),
  })), [searchable, found.data, t, router]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
        className="mz-input inline-flex w-auto min-w-0 items-center gap-2 text-text-3 md:w-72">
        <Icon name="search" size={16} />
        <span className="hidden flex-1 truncate text-start md:inline">{t("open")}</span>
        <span className="sr-only md:hidden">{t("open")}</span>
        <kbd className="mz-kbd hidden md:inline" dir="ltr">{mac ? SHORTCUT.mac : SHORTCUT.other}</kbd>
      </button>
      <CommandPalette open={open} onClose={() => setOpen(false)} commands={commands} results={results} onQueryChange={setTyped} busy={searchable && found.isFetching} />
    </>
  );
}
