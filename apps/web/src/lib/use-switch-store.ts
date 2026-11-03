"use client";

import { useTranslations } from "next-intl";
import { useCallback } from "react";
import { useToast } from "@/components/ui/Toast";
import { usePathname, useRouter } from "@/i18n/navigation";
import { sectionRoot } from "@/lib/section-root";
import { useSession } from "@/lib/session";

/** Switch store from the shell: go to the section's own page and say which store you are in now. */
export function useSwitchStore() {
  const t = useTranslations("shell.store");
  const { stores, selectStore } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  return useCallback((tenantId: string) => {
    const next = stores.find((s) => s.tenantId === tenantId);
    if (!next) return;
    selectStore(tenantId);
    const root = sectionRoot(pathname);
    if (root !== pathname) router.push(root);
    toast({ message: t("switched", { store: next.tenantName }) });
  }, [stores, selectStore, pathname, router, toast, t]);
}
