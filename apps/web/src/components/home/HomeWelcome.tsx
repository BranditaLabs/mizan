"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useLocale, useTranslations } from "next-intl";
import { Bdi } from "@/components/Bdi";
import { buttonClass } from "@/components/ui/Button";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useCanSetUp, useOnboarding, type Onboarding } from "@/components/onboarding/useOnboarding";

type State = "connect" | "importing" | "importFailed" | "waiting" | "manual" | "team";

/** Where the store stands before its first order: a connected store is never asked to connect again. */
function stateOf(o: Onboarding | undefined, canSetUp: boolean): State {
  if (!canSetUp) return "team";
  const store = o?.steps.store;
  if (!store || store.status !== "done") return "connect";
  if (!store.provider) return "manual";
  if (store.import?.status === "running") return "importing";
  if (store.import?.status === "failed") return "importFailed";
  return "waiting";
}

const CTA: Partial<Record<State, string>> = { connect: "/onboarding", importFailed: "/onboarding", waiting: "/orders", manual: "/orders/new", team: "/orders" };

/** Home before the first order (E9-4 fallback): the subtitle and the empty state, from the store's setup. */
export function HomeWelcome() {
  const t = useTranslations("home");
  const locale = useLocale();
  const { store } = useSession();
  const canSetUp = useCanSetUp();
  const q = useOnboarding();
  // Until the setup state is known, nothing that could be wrong (no "connect" flash for a connected store).
  if (canSetUp && q.isPending) return null;
  const state = stateOf(q.data, canSetUp);
  const shop = q.data?.steps.store.shop ?? "";
  const cta = CTA[state];
  const k = state === "connect" ? "empty" : state;
  return (
    <>
      <p className="mt-1.5 max-w-[62ch] text-body text-text-2">{state === "connect" ? t("subtitle") : t("subtitleConnected")}</p>
      {/* Empty state (components.md §6): icon, one-line title, one sentence, one action. */}
      <section className="mt-6 rounded-lg border border-line bg-surface p-6" aria-labelledby="empty-title" data-testid="home-welcome" data-state={state}>
        <Icon name={state === "importFailed" ? "error" : "orders"} size={24} className="text-text-3" />
        <h2 id="empty-title" className="mt-3 text-heading-sm">{t(`${k}.title`)}</h2>
        <p className="mt-1 text-body text-text-2">
          {t.rich(`${k}.body`, { days: 60, shop: () => <Bdi code>{shop}</Bdi> })}
        </p>
        {state !== "importing" && state !== "importFailed" && (
          <p className="mt-3 text-body-sm text-text-3" data-testid="example">
            {t.rich("example", {
              number: "#1042",
              // The example in the store's own currency (a Saudi store sees SAR, not EGP).
              amount: formatMoney({ amount: "1150.00", currency: store?.baseCurrency?.trim() || "EGP" }, locale),
              num: (chunks) => <Bdi code>{chunks}</Bdi>,
              money: (chunks) => <Bdi>{chunks}</Bdi>,
            })}
          </p>
        )}
        {cta && (
          <Link href={cta} className={buttonClass("primary", "md", "mt-4")}>
            {t(`${k}.cta`)}
            <Icon name="forward" size={16} />
          </Link>
        )}
      </section>
    </>
  );
}
