"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Progress, SkeletonRows } from "@/components/ui/Surface";
import { Link, useRouter } from "@/i18n/navigation";
import { CostsStep, CourierStep, FirstOrderStep, StoreStep } from "./Steps";
import { finished, STEP_ORDER, useCanSetUp, useOnboarding, type Onboarding, type StepKey } from "./useOnboarding";

const STEP_TITLES = { store: "store.title", courier: "courier.title", costs: "costs.title", firstOrder: "firstOrder.title" } as const;
const BODY = { store: "store.body", courier: "courier.body", costs: "costs.body", firstOrder: null } as const;
const TONE: Record<string, string> = {
  done: "text-success-text", skipped: "text-text-3", needs_attention: "text-danger-text", checking: "text-info-text", todo: "text-text-3", waiting: "text-text-3",
};

/** The first step not finished yet (or the last one). */
const current = (o: Onboarding): StepKey => STEP_ORDER.find((s) => !finished(o, s)) ?? "firstOrder";

/**
 * Store setup (E4-5): connect the store → courier → product costs → first order. One step open at a
 * time (the next unfinished one by default); every step can be reopened. Owners and admins only.
 */
export function OnboardingWizard() {
  const t = useTranslations("onboarding");
  const can = useCanSetUp();
  const router = useRouter();
  const q = useOnboarding();
  const [open, setOpen] = useState<StepKey | null>(null);
  useEffect(() => { if (!can) router.replace("/"); }, [can, router]);

  if (!can) return null;
  if (!q.data) return <div className="mx-auto max-w-[960px] px-4 pt-6 md:px-6"><SkeletonRows rows={4} label={t("title")} /></div>;
  const o = q.data;
  const done = STEP_ORDER.filter((s) => finished(o, s)).length;
  const step = open ?? current(o);
  const status = (s: StepKey) => (s !== "store" && o.steps.store.status !== "done" && s !== "firstOrder" ? "locked" : o.steps[s].status);

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6 px-4 pt-6 pb-14 md:px-6">
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="mt-1 text-body text-text-2">{t("subtitle")}</p>
        <div className="mt-4 flex max-w-[420px] items-center gap-3">
          <Progress value={(done / STEP_ORDER.length) * 100} label={t("progress", { done, total: STEP_ORDER.length })} className="flex-1" />
          <span className="text-caption text-text-2" data-testid="onboarding-progress">{t("progress", { done, total: STEP_ORDER.length })}</span>
        </div>
      </header>

      {o.complete ? (
        <Alert tone="success" title={t("ready.title")}>
          {t("ready.body")}{" "}
          <Link href="/" className="font-medium underline underline-offset-2">{t("ready.cta")}</Link>
        </Alert>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
        <nav aria-label={t("stepsLabel")}>
          <ol className="flex gap-2 overflow-x-auto md:flex-col">
            {STEP_ORDER.map((s, i) => {
              const st = status(s);
              return (
                <li key={s} className="shrink-0">
                  <button type="button" onClick={() => setOpen(s)} aria-current={s === step ? "step" : undefined}
                    className={`flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-start ${s === step ? "border-line-strong bg-surface" : "border-transparent hover:bg-surface-hover"}`}>
                    <span className={`grid size-6 shrink-0 place-items-center rounded-full border text-caption ${finished(o, s) ? "border-success-text text-success-text" : "border-line-strong text-text-2"}`}>
                      {finished(o, s) ? <Icon name="confirm" size={14} /> : <bdi>{i + 1}</bdi>}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-label">{t(STEP_TITLES[s])}</span>
                      <span className={`block text-caption ${TONE[st] ?? "text-text-3"}`}>{t(`status.${st}`)}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <section aria-labelledby="step-title" className="mz-card p-5 sm:p-6">
          <h2 id="step-title" className="text-heading-sm">{t(STEP_TITLES[step])}</h2>
          {BODY[step] ? <p className="mt-1 mb-5 max-w-[60ch] text-body-sm text-text-2">{t(BODY[step])}</p> : <div className="mb-4" />}
          {step === "store" ? <StoreStep o={o} /> : step === "courier" ? <CourierStep o={o} /> : step === "costs" ? <CostsStep o={o} /> : <FirstOrderStep o={o} />}
        </section>
      </div>
    </div>
  );
}
