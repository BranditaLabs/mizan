"use client";

import { Icon, type IconProps } from "@mizan/design-system/icons/react";
import { useTranslations } from "next-intl";

const POINTS: ReadonlyArray<{ key: "whatsapp" | "owed" | "profit"; icon: IconProps["name"] }> = [
  { key: "whatsapp", icon: "verification" }, { key: "owed", icon: "cod" }, { key: "profit", icon: "profit" },
];

/**
 * The brand side of the sign-in screen, as the "Sign in · glass" board of the Mizan Glass canvas:
 * what Mizan is in one line, an order floating in glass whose status cycles from deposit to shipped
 * to settled, its net profit beside it, and three things it does that a store feels.
 */
export function BrandPanel() {
  const t = useTranslations("auth.brand");
  return (
    <>
      <span className="glow" aria-hidden="true" />
      <div className="relative flex max-w-[520px] flex-col gap-4">
        <span className="eyebrow">{t("kicker")}</span>
        <h2 className="disp auth-headline m-0 text-balance">
          {t("headline")}<br /><span className="muted">{t("headline2")}</span>
        </h2>
      </div>

      <div className="relative grid min-h-0 flex-1 place-items-center py-[clamp(8px,3vh,32px)]" aria-hidden="true">
        <div className="relative mb-[72px] w-[min(100%,380px)]">
          <div className="g g-solid auth-float flex w-full flex-col gap-4 auth-order p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="mono text-body-sm">{t("orderId")}</span>
              <span className="auth-cycle">
                <span className="chip warn">{t("status1")}</span>
                <span className="chip info">{t("status2")}</span>
                <span className="chip ok">{t("status3")}</span>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="icon-tile size-10 text-caption font-semibold">{t("initials")}</span>
              <span className="flex flex-1 flex-col gap-1">
                <span className="text-body font-semibold">{t("customer")}</span>
                <span className="faint text-caption">{t("method")}</span>
              </span>
              <span className="num text-body-lg font-semibold">{t("amount")}</span>
            </div>
            <div className="flex gap-1.5">
              <span className="h-1 flex-1 rounded-full bg-text" />
              <span className="h-1 flex-1 rounded-full bg-text" />
              <span className="h-1 flex-1 rounded-full bg-text-3" />
              <span className="h-1 flex-1 rounded-full bg-line-strong" />
            </div>
          </div>
          <div className="g g-solid auth-float b absolute top-[calc(100%-8px)] -end-[clamp(0px,6vw,80px)] flex flex-col gap-1.5 auth-profit px-4 py-3.5">
            <span className="faint text-caption">{t("profitLabel")}</span>
            <span className="disp num text-kpi-sm">{t("profit")}</span>
          </div>
        </div>
      </div>

      <ul className="relative m-0 grid [@media(max-height:700px)]:hidden list-none grid-cols-3 gap-3.5 p-0">
        {POINTS.map((p) => (
          <li key={p.key} className="g-2 auth-point flex flex-col gap-2.5 p-4">
            <Icon name={p.icon} size={20} />
            <span className="text-body font-semibold leading-snug">{t(`points.${p.key}.title`)}</span>
            <span className="muted text-body-sm leading-normal">{t(`points.${p.key}.body`)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
