"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { Alert } from "@/components/ui/Alert";
import { buttonClass } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { Link, useRouter } from "@/i18n/navigation";
import { ApiError, ok } from "@/lib/api/client";
import { problemText } from "@/lib/api/query";
import { useSession } from "@/lib/session";
import { useRefreshOnboarding } from "./useOnboarding";

const KNOWN = ["install_cancelled", "invalid_signature", "invalid_state", "invalid_shop", "scopes_missing", "shopify_unavailable", "shopify_not_configured", "install_failed"] as const;
const INSTALL = /^[A-Za-z0-9_-]{43}$/;

/**
 * Back from Shopify: claim the approved install into the current store (once), then return to
 * setup. An error from the callback, or a refused claim, is explained in place.
 */
export function ShopifyConnect({ install, error }: { install: string | null; error: string | null }) {
  const t = useTranslations("onboarding.connect");
  const tp = useTranslations("problems");
  const { api } = useSession();
  const router = useRouter();
  const toast = useToast();
  const refresh = useRefreshOnboarding();
  const claim = useMutation({
    mutationFn: (token: string) => ok(api.POST("/v1/connections/shopify/claim", { body: { install: token } })),
    onSuccess: () => { toast({ message: t("done") }); void refresh(); router.replace("/onboarding"); },
    meta: { toast: false }, // explained on the page
  });
  const started = useRef(false);
  const valid = Boolean(install && INSTALL.test(install)) && !error;
  useEffect(() => {
    if (!valid || started.current) return;
    started.current = true; // the install token is single use: never claim twice (React strict mode runs effects twice)
    claim.mutate(install!);
  }, [valid, install, claim]);

  const message = error ? t(`errors.${(KNOWN as readonly string[]).includes(error) ? error : "install_failed"}`)
    : !valid ? t("errors.missing")
    : claim.isError ? (claim.error instanceof ApiError && claim.error.title ? claim.error.title : problemText(claim.error, (k) => tp(k)))
    : null;
  return (
    <div className="mx-auto flex max-w-[560px] flex-col gap-4 px-4 pt-10 pb-14">
      <h1 className="font-display text-heading-md">{t("title")}</h1>
      {message ? (
        <>
          <Alert tone="danger">{message}</Alert>
          <div><Link href="/onboarding" className={buttonClass("secondary")}>{t("back")}</Link></div>
        </>
      ) : (
        <p role="status" className="flex items-center gap-2.5 text-body-sm text-text-2">
          <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-line-strong border-t-transparent" />
          {t("working")}
        </p>
      )}
    </div>
  );
}
