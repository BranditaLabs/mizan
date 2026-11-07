"use client";

import { useTranslations } from "next-intl";
import { useEffect, type ReactNode } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { usePathname, useRouter } from "@/i18n/navigation";
import { resume, signInPath } from "@/lib/next-path";
import { useSession } from "@/lib/session";
import { BootLoader } from "@/components/ui/Loader";
import { CardSkeleton } from "@mizan/design-system/auth/react";

export function Loading() {
  const t = useTranslations("gate");
  return (
    <BootLoader label={t("loading")} />
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

/**
 * Send a signed-out visitor to sign-in, then back here (or where a deliberate sign-out asked to
 * go). A session that ended by itself (token revoked, sign-in disabled, signed out in another tab)
 * says so on the sign-in screen (reason=expired).
 */
function useSignInRedirect(active: boolean) {
  const router = useRouter();
  const pathname = usePathname();
  const { takeSignOutTarget, sessionEnded } = useSession();
  useEffect(() => {
    if (!active) return;
    const target = takeSignOutTarget();
    if (target) return void router.replace(target);
    // Keep the query (the Shopify callback's one-time install token must survive a sign-in).
    router.replace(signInPath(pathname + window.location.search, sessionEnded()));
  }, [active, pathname, router, takeSignOutTarget, sessionEnded]);
}

/** Pages that need a signed-in person but no store (welcome, two-step). */
export function RequireUser({ children }: { children: ReactNode }) {
  const t = useTranslations("gate");
  const { status, me, meError } = useSession();
  useSignInRedirect(status === "signed-out");
  // Inside the auth card: a skeleton the size of a step, shown only after 300ms (never a flash).
  if (status !== "signed-in" || !me) return meError && status === "signed-in" ? <Unavailable /> : <CardSkeleton label={t("loading")} />;
  return <>{children}</>;
}

/**
 * The store pages' gate: signed in → has a store (else welcome) → the API accepts this person in it
 * (owners and admins without two-step verification are sent to turn it on).
 */
export function StoreGate({ children }: { children: ReactNode }) {
  const { status, me, meError, stores, storeCheck } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  useSignInRedirect(status === "signed-out");
  const noStore = Boolean(me) && stores.length === 0;
  useEffect(() => {
    if (!noStore && storeCheck !== "mfa_required") return;
    // Come back here afterwards (the Shopify install's one-time link must survive the detour).
    resume.save(pathname + window.location.search);
    router.replace(noStore ? "/welcome" : "/security/two-step");
  }, [noStore, storeCheck, router, pathname]);

  if (status !== "signed-in") return <Loading />;
  if (!me) return meError ? <Unavailable /> : <Loading />;
  if (storeCheck === "unavailable") return <Unavailable />;
  if (storeCheck !== "ok") return <Loading />;
  return <>{children}</>;
}
