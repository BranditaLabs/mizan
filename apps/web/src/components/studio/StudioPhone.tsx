"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/ui/Button";
import { Switch } from "@/components/ui/Choice";
import { useToast } from "@/components/ui/Toast";
import type { Schemas } from "@/lib/api/client";
import { keep, nextStep, simulate, START, visibleTurns, type Scenario, type SimAction, type SimState } from "./simulation";
import { WhatsAppPhone, type PhoneChrome, type PhoneReply } from "./WhatsAppPhone";

type Preview = Schemas["ScriptPreview"];
const TYPING_MS = 600;
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The phone with its simulation controls (E6-16b): restart, jump to a scenario, "with an offer".
 * The buyer's taps go through `simulate`; the store's next reply shows after a short "typing…".
 */
export function StudioPhone({ preview, lang, chrome, storeName, logo, loading, failed, activeKey, issueKeys, onEdit, sim, onSim, offer, onOffer, view }: {
  preview: Preview | undefined;
  lang: "ar" | "en";
  chrome: PhoneChrome;
  storeName: string;
  logo: string | null;
  loading: boolean;
  failed: boolean;
  activeKey: string | null;
  issueKeys: ReadonlySet<string>;
  onEdit(key: string): void;
  sim: SimState;
  onSim(next: SimState): void;
  offer: boolean;
  onOffer(on: boolean): void;
  view: "chat" | "call" | "link";
}) {
  const t = useTranslations("confirmationStudio.phone");
  const toast = useToast();
  const [typing, setTyping] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const convs = preview?.conversations ?? [];
  const state = keep(convs, sim);
  const act = (action: SimAction) => {
    const r = simulate(convs, state, action);
    if ("nowhere" in r) { toast({ message: t("nowhere") }); return; }
    if (timer.current) clearTimeout(timer.current);
    onSim(r.state);
    if (r.animate && !reduced()) {
      setTyping(true);
      timer.current = setTimeout(() => setTyping(false), TYPING_MS);
    } else setTyping(false);
  };
  const all = visibleTurns(convs, state);
  const turns = typing && state.scenario ? all.slice(0, -1) : all;
  const step = typing ? null : nextStep(convs, state);
  const replies: PhoneReply[] = [
    ...(step?.kind === "typed" ? [{ id: "next", label: t("sendSample"), hint: step.text }] : []),
    { id: "message", label: t("reply.message") },
    { id: "opt_out", label: t("reply.opt_out") },
    { id: "opt_in", label: t("reply.opt_in") },
  ];
  const scenarios = convs.map((c) => c.scenario);

  return (
    <div className="flex flex-col gap-3" data-testid="studio-phone">
      <div className="flex flex-wrap items-center gap-2">
        <Switch label={t("withOffer")} checked={offer} onChange={(e) => onOffer(e.target.checked)} className="min-w-0 flex-1" />
        <label className="sr-only" htmlFor="studio-scenario">{t("jump")}</label>
        <select id="studio-scenario" className="mz-select" style={{ inlineSize: "11rem" }} value={state.scenario ?? ""}
          onChange={(e) => { const v = e.target.value as Scenario | ""; setTyping(false); if (v) act({ type: "jump", scenario: v }); else onSim(START); }}>
          <option value="">{t("start")}</option>
          {scenarios.map((sc) => <option key={sc} value={sc}>{t(`scenario.${sc}`)}</option>)}
        </select>
        <IconButton icon="refresh" label={t("restart")} variant="secondary" onClick={() => { setTyping(false); onSim(START); }} />
      </div>
      {failed ? <p className="text-caption text-danger" role="status">{t("failed")}</p> : null}
      <WhatsAppPhone lang={lang} chrome={chrome} storeName={storeName} logo={logo} turns={turns} typing={typing} loading={loading}
        activeKey={activeKey} issueKeys={issueKeys} onEdit={onEdit} pulse={state.scenario === null && !loading && turns.length > 0}
        onTemplate={(index) => act({ type: "template", index, offer })}
        tapOn={step?.kind === "tap" ? step.on : null}
        onButton={(turn, index) => act({ type: "button", turn, index })}
        onList={(turn, title) => act({ type: "list", turn, title })}
        chosen={state.chosen} replies={replies}
        onReply={(id) => act({ type: "compose", reply: id as "next" | "message" | "opt_out" | "opt_in" })}
        view={view} call={preview?.call} link={preview?.link} follow label={t("label")} />
    </div>
  );
}
