"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { apiReady, nextCheckIn, useOutage } from "@/lib/outage";
import { GlassRoot } from "./GlassRoot";
import { buttonClass } from "./ui/Button";
import { MizanLoader } from "@mizan/design-system/react/motion";
import { BrandLockup } from "./Wordmark";

const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
};

/**
 * The waiting screen while Mizan is out of service (lib/outage): over the whole dashboard, so
 * nothing on screen is lost (an open form keeps what was typed). It checks /health/ready by itself
 * (at once, then after 5, 10, 20 and every 30 seconds; again as soon as the device is back online),
 * then refetches what failed and lifts. An offline device is told to check its own connection.
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
    <GlassRoot className="fixed inset-0 z-[60]">
      <div role="alertdialog" aria-modal="true" aria-labelledby="outage-title" aria-describedby="outage-body" className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6 text-center">
        {/* Waiting for Mizan to come back: the brand pair (this screen's one red); without JS the SMIL file. */}
        <MizanLoader kind="pair" size={120} tone="brand" decorative />
        <noscript>
          {/* eslint-disable-next-line @next/next/no-img-element -- static SMIL fallback, no JS */}
          <img src="/motion/mizan-pair-on-paper.svg" alt="" width={120} />
        </noscript>
        <div className="flex max-w-[440px] flex-col items-center gap-3">
          <h1 id="outage-title" className="text-heading-lg text-text">{online ? t("title") : t("offlineTitle")}</h1>
          <p id="outage-body" className="text-body text-text-2">{online ? t("body") : t("offlineBody")}</p>
          <p className="text-body-sm text-text-3" aria-live="polite">
            {!online ? t("waitingNetwork") : checking ? t("checking") : t("nextCheck", { seconds: wait })}
          </p>
        </div>
        <button ref={button} type="button" className={buttonClass("secondary")} onClick={() => setRound((r) => r + 1)} disabled={checking || !online}>{t("checkNow")}</button>
        <BrandLockup tone="mono" className="opacity-70" height={22} />
      </div>
    </GlassRoot>
  );
}
