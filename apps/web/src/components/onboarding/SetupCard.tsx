"use client";

import { useTranslations } from "next-intl";
import { buttonClass, Button } from "@/components/ui/Button";
import { Progress } from "@/components/ui/Surface";
import { Link } from "@/i18n/navigation";
import { finished, STEP_ORDER, useOnboarding, useUpdateOnboarding } from "./useOnboarding";

const NEXT = { store: "store.title", courier: "courier.title", costs: "costs.title", firstOrder: "firstOrder.title" } as const;

/** Home: "finish setting up" until setup is complete or hidden (owners and admins). */
export function SetupCard() {
  const t = useTranslations("onboarding");
  const q = useOnboarding();
  const hide = useUpdateOnboarding();
  const o = q.data;
  if (!o || o.complete || o.dismissed) return null;
  const done = STEP_ORDER.filter((s) => finished(o, s)).length;
  const next = STEP_ORDER.find((s) => !finished(o, s)) ?? "firstOrder";
  return (
    <section aria-labelledby="setup-title" className="mz-card mt-6 flex flex-col gap-3 p-5" data-testid="setup-card">
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h2 id="setup-title" className="text-heading-sm">{t("card.title")}</h2>
          <p className="mt-1 text-body-sm text-text-2">{t("card.body", { done, total: STEP_ORDER.length, next: t(NEXT[next]) })}</p>
        </div>
        <Button variant="ghost" size="sm" busy={hide.isPending} onClick={() => hide.mutate({ dismissed: true })}>{t("card.hide")}</Button>
      </div>
      <Progress value={(done / STEP_ORDER.length) * 100} label={t("progress", { done, total: STEP_ORDER.length })} />
      <div><Link href="/onboarding" className={buttonClass("primary")}>{t("card.cta")}</Link></div>
    </section>
  );
}
