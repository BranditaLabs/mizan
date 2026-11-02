"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { Link } from "@/i18n/navigation";
import { finished, GROW_ORDER, STEP_ORDER, useOnboarding, type StepKey } from "./useOnboarding";

const TITLES: Record<StepKey, string> = {
  store: "store.title", courier: "courier.title", costs: "costs.title", firstOrder: "firstOrder.title",
  team: "grow.team.title", whatsapp: "grow.whatsapp.title", payments: "grow.payments.title", returns: "grow.returns.title",
};
const FOLDED = "mizan.checklist.folded";
const CHANGED = "mizan:checklist";
const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  window.addEventListener(CHANGED, cb);
  return () => { window.removeEventListener("storage", cb); window.removeEventListener(CHANGED, cb); };
};
const readFolded = () => {
  try { return localStorage.getItem(FOLDED) === "1"; } catch { return false; }
};

/**
 * The setup checklist in the side rail (A4): getting started until the store runs, then growing it,
 * always one tap from any screen (not only home). Each step opens setup at that step; it folds away
 * (remembered in this browser) and steps aside when every step is done or skipped. Owners and admins.
 */
export function SetupChecklist() {
  const t = useTranslations("onboarding");
  const q = useOnboarding();
  // Read after hydration (the server renders it open), so both renders agree.
  const folded = useSyncExternalStore(subscribe, readFolded, () => false);
  const o = q.data;
  if (!o) return null;
  const group = o.complete ? GROW_ORDER : STEP_ORDER;
  const left = group.filter((s) => !finished(o, s));
  if (o.complete && !left.length) return null;
  const done = group.length - left.length;
  const fold = (v: boolean) => {
    try { localStorage.setItem(FOLDED, v ? "1" : "0"); } catch { /* storage off: it stays open */ }
    window.dispatchEvent(new Event(CHANGED));
  };
  return (
    <section className="mx-6 mb-3 rounded-md border border-rail-line p-3" aria-labelledby="checklist-title" data-testid="setup-checklist">
      <div className="flex items-center gap-2">
        <h2 id="checklist-title" className="min-w-0 flex-1 truncate text-caption font-semibold text-rail-text">{t(o.complete ? "rail.grow" : "rail.setup")}</h2>
        <span className="text-caption text-rail-text-2"><bdi>{t("rail.count", { done, total: group.length })}</bdi></span>
        <button type="button" onClick={() => fold(!folded)} aria-expanded={!folded} aria-controls="checklist-steps"
          aria-label={t(folded ? "rail.show" : "rail.hide")} title={t(folded ? "rail.show" : "rail.hide")}
          className="grid size-6 place-items-center rounded text-rail-text-2 hover:text-rail-text">
          <Icon name={folded ? "chevron-down" : "chevron-up"} size={14} />
        </button>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-rail-line" aria-hidden="true">
        <div className="h-full rounded-full bg-rail-text" style={{ inlineSize: `${(done / group.length) * 100}%` }} />
      </div>
      {folded ? null : (
        <ul id="checklist-steps" className="mt-2 flex flex-col">
          {left.map((s) => (
            <li key={s}>
              <Link href={`/onboarding?step=${s}`} className="flex items-center gap-2 rounded px-1 py-1 text-caption text-rail-text-2 hover:text-rail-text">
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
                <span className="truncate">{t(TITLES[s] as never)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
