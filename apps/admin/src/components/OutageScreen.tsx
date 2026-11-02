"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { apiReady, nextCheckIn, useOutage } from "@/lib/outage";
import { buttonClass } from "./ui/Button";
import { Wordmark } from "./Wordmark";

const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
};

/**
 * The waiting screen while Mizan is out of service (lib/outage), as in the dashboard: over the whole
 * back office, checking /health/ready at once, then after 5, 10, 20 and every 30 seconds (and when
 * the device is back online); it refetches what failed and lifts.
 */
export function OutageScreen() {
  const { down, restored } = useOutage();
  const t = useTranslations("outage");
  const queryClient = useQueryClient();
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [checking, setChecking] = useState(false);
  const [wait, setWait] = useState(0);
  const [round, setRound] = useState(0); // "Check now" starts the schedule again
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (down) button.current?.focus(); }, [down]);

  useEffect(() => {
    if (!down || !online) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const countdown = (seconds: number) => {
      setWait(seconds);
      timer = setTimeout(() => (seconds > 1 ? countdown(seconds - 1) : void run()), 1000);
    };
    const run = async () => {
      setChecking(true);
      const ready = await apiReady();
      if (stopped) return;
      setChecking(false);
      if (!ready) return countdown(nextCheckIn(attempt++));
      restored();
      void queryClient.refetchQueries({ type: "active", predicate: (q) => q.state.status === "error" });
    };
    timer = setTimeout(() => void run(), 0);
    return () => { stopped = true; clearTimeout(timer); };
  }, [down, online, round, queryClient, restored]);

  if (!down) return null;
  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="outage-title" aria-describedby="outage-body" className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-bg px-6 text-center">
      <Wordmark />
      <div className="flex max-w-[440px] flex-col items-center gap-3">
        <h1 id="outage-title" className="text-heading-lg text-text">{online ? t("title") : t("offlineTitle")}</h1>
        <p id="outage-body" className="text-body-sm text-text-2">{online ? t("body") : t("offlineBody")}</p>
        <p className="text-body-sm text-text-3" aria-live="polite">
          {!online ? t("waitingNetwork") : checking ? t("checking") : t("nextCheck", { seconds: wait })}
        </p>
      </div>
      <button ref={button} type="button" className={buttonClass("secondary")} onClick={() => setRound((r) => r + 1)} disabled={checking || !online}>{t("checkNow")}</button>
    </div>
  );
}
