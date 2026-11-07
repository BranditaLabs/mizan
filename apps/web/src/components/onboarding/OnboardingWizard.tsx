"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { FillProgress, SkeletonRows } from "@/components/ui/Surface";
import { Link, useRouter } from "@/i18n/navigation";
import { CostsStep, CourierStep, FirstOrderStep, GrowStep, StoreStep } from "./Steps";
import { finished, GROW_ORDER, STEP_ORDER, useCanSetUp, useOnboarding, type Onboarding, type StepKey } from "./useOnboarding";

const STEP_TITLES = {
  store: "store.title", courier: "courier.title", costs: "costs.title", firstOrder: "firstOrder.title",
  team: "grow.team.title", whatsapp: "grow.whatsapp.title", payments: "grow.payments.title", returns: "grow.returns.title",
} as const;
const BODY = { store: "store.body", courier: "courier.body", costs: "costs.body", firstOrder: null, team: null, whatsapp: null, payments: null, returns: null } as const;
const ALL: readonly StepKey[] = [...STEP_ORDER, ...GROW_ORDER];
const TONE: Record<string, string> = {
  done: "text-success-text", skipped: "text-text-3", needs_attention: "text-danger-text", checking: "text-info-text", todo: "text-text-3", waiting: "text-text-3",
};

/** The first step not finished yet: getting started first, then growing the store (or the last one). */
const current = (o: Onboarding): StepKey => STEP_ORDER.find((s) => !finished(o, s)) ?? GROW_ORDER.find((s) => !finished(o, s)) ?? "returns";

/**
 * Store setup (E4-5): connect the store → courier → product costs → first order. One step open at a
 * time (the next unfinished one by default); every step can be reopened. Owners and admins only.
 */
export function OnboardingWizard() {
  const t = useTranslations("onboarding");
  const can = useCanSetUp();
  const router = useRouter();
  const q = useOnboarding();
  // The step opened by hand, and whether it was already finished then: finishing it moves on to the next one.
  const [open, setOpen] = useState<{ step: StepKey; wasFinished: boolean } | null>(null);
  // ?step=team opens a step from the side rail's checklist (A4).
  const asked = useSearchParams().get("step") as StepKey | null;
  useEffect(() => { if (!can) router.replace("/"); }, [can, router]);

  if (!can) return null;
  if (!q.data) return <div className="mx-auto max-w-[960px] px-4 pt-6 md:px-6"><SkeletonRows rows={4} label={t("title")} /></div>;
  const o = q.data;
  const done = STEP_ORDER.filter((s) => finished(o, s)).length;
  const fromLink = asked && ALL.includes(asked) && !finished(o, asked) ? asked : null;
  const step = open && !(finished(o, open.step) && !open.wasFinished) ? open.step : fromLink ?? current(o);
  const growDone = GROW_ORDER.filter((s) => finished(o, s)).length;
  const status = (s: StepKey) => (s !== "store" && o.steps.store.status !== "done" && s !== "firstOrder" && STEP_ORDER.includes(s) ? "locked" : o.steps[s].status);
  const item = (s: StepKey, n: number) => {
    const st = status(s);
    return (
      <li key={s} className="shrink-0">
        <button type="button" onClick={() => setOpen({ step: s, wasFinished: finished(o, s) })} aria-current={s === step ? "step" : undefined}
          className={`flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-start ${s === step ? "border-line-strong bg-surface" : "border-transparent hover:bg-surface-hover"}`}>
          <span className={`grid size-6 shrink-0 place-items-center rounded-full border text-caption ${finished(o, s) ? "border-success-text text-success-text" : "border-line-strong text-text-2"}`}>
            {finished(o, s) ? <Icon name="confirm" size={14} /> : <bdi>{n}</bdi>}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-label">{t(STEP_TITLES[s])}</span>
            <span className={`block text-caption ${TONE[st] ?? "text-text-3"}`}>{t(`status.${st}`)}</span>
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6 px-4 pt-6 pb-14 md:px-6">
      <header>
        <h1 className="font-display text-heading-lg">{t("title")}</h1>
        <p className="mt-1 text-body text-text-2">{t("subtitle")}</p>
        <div className="mt-4 flex max-w-[420px] items-center gap-3">
          <FillProgress value={(done / STEP_ORDER.length) * 100} label={t("progress", { done, total: STEP_ORDER.length })} valueText={t("progress", { done, total: STEP_ORDER.length })} width={200} />
          <span className="text-caption text-text-2" data-testid="onboarding-progress">{t("progress", { done, total: STEP_ORDER.length })}</span>
        </div>
      </header>

      {o.complete ? (
        <Alert tone="success" title={t("ready.title")}>
          {t("ready.body")}{" "}
          <Link href="/" className="font-medium underline underline-offset-2">{t("ready.cta")}</Link>
        </Alert>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[260px_minmax(0,1fr)]">
        <nav aria-label={t("stepsLabel")} className="flex min-w-0 flex-col gap-4">
          <ol className="flex gap-2 overflow-x-auto md:flex-col">{STEP_ORDER.map((s, i) => item(s, i + 1))}</ol>
          <div className="flex flex-col gap-2">
            <h2 className="px-1 text-caption font-semibold text-text-2">
              {t("grow.title")}{" "}<span className="font-normal text-text-3" data-testid="grow-progress">{t("progress", { done: growDone, total: GROW_ORDER.length })}</span>
            </h2>
            <ol className="flex gap-2 overflow-x-auto md:flex-col">{GROW_ORDER.map((s, i) => item(s, STEP_ORDER.length + i + 1))}</ol>
          </div>
        </nav>

        <section aria-labelledby="step-title" className="mz-card min-w-0 p-5 sm:p-6">
          <h2 id="step-title" className="text-heading-sm">{t(STEP_TITLES[step])}</h2>
          {BODY[step] ? <p className="mt-1 mb-5 max-w-[60ch] text-body-sm text-text-2">{t(BODY[step])}</p> : <div className="mb-4" />}
          {step === "store" ? <StoreStep o={o} /> : step === "courier" ? <CourierStep o={o} /> : step === "costs" ? <CostsStep o={o} />
            : step === "firstOrder" ? <FirstOrderStep o={o} /> : <GrowStep o={o} step={step} />}
        </section>
      </div>
    </div>
  );
}
