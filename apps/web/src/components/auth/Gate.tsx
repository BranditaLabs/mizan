"use client";

import { useTranslations } from "next-intl";
import { useEffect, type ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useSession } from "@/lib/session";

export function Loading() {
  const t = useTranslations("gate");
  return (
    <div role="status" className="flex min-h-[50dvh] items-center justify-center gap-2.5 text-body-sm text-text-2">
      <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-line-strong border-t-transparent" />
      {t("loading")}
    </div>
  );
}

function Unavailable() {
  const t = useTranslations("gate");
  const { retry } = useSession();
  return (
    <div className="mx-auto flex max-w-[420px] flex-col gap-3 px-4 pt-14">
      <Alert tone="warning">{t("unavailable")}</Alert>
      <Button variant="secondary" onClick={retry}>{t("retry")}</Button>
    </div>
  );
}

/** Send a signed-out visitor to sign-in, then back here (or where a deliberate sign-out asked to go). */
function useSignInRedirect(active: boolean) {
  const router = useRouter();
  const pathname = usePathname();
  const { takeSignOutTarget } = useSession();
  useEffect(() => {
    // Keep the query (the Shopify callback's one-time install token must survive a sign-in).
    if (active) router.replace(takeSignOutTarget() ?? `/sign-in?next=${encodeURIComponent(pathname + window.location.search)}`);
  }, [active, pathname, router, takeSignOutTarget]);
}

/** Pages that need a signed-in person but no store (welcome, two-step). */
export function RequireUser({ children }: { children: ReactNode }) {
  const { status, me, meError } = useSession();
  useSignInRedirect(status === "signed-out");
  if (status !== "signed-in") return <Loading />;
  if (!me) return meError ? <Unavailable /> : <Loading />;
  return <>{children}</>;
}

/**
 * The store pages' gate: signed in → has a store (else welcome) → the API accepts this person in it
 * (owners and admins without two-step verification are sent to turn it on).
 */
export function StoreGate({ children }: { children: ReactNode }) {
  const { status, me, meError, stores, storeCheck } = useSession();
  const router = useRouter();
  useSignInRedirect(status === "signed-out");
  const noStore = Boolean(me) && stores.length === 0;
  useEffect(() => {
    if (noStore) router.replace("/welcome");
    else if (storeCheck === "mfa_required") router.replace("/security/two-step");
  }, [noStore, storeCheck, router]);

  if (status !== "signed-in") return <Loading />;
  if (!me) return meError ? <Unavailable /> : <Loading />;
  if (storeCheck === "unavailable") return <Unavailable />;
  if (storeCheck !== "ok") return <Loading />;
  return <>{children}</>;
}
