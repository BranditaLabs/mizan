"use client";

import { PROVIDER_SLUGS } from "@mizan/shared";
import { Icon } from "@mizan/design-system/icons/react";
import { EventGlyph } from "@mizan/design-system/react/motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { Bdi } from "@/components/Bdi";
import { buttonClass } from "@/components/ui/Button";
import { DateText } from "@/components/ui/Values";
import { Link } from "@/i18n/navigation";
import { ok, type Schemas } from "@/lib/api/client";
import { useFresh, useSurfaceMounted } from "@/lib/motion/EventMotionProvider";
import { bellEvent, eventMotion } from "@/lib/motion/resolve";
import { usePollMotion } from "@/lib/motion/usePollMotion";
import { useSession } from "@/lib/session";

type Note = Schemas["NotificationList"]["data"][number];

/** Where a notification leads: its order, the stock screen, or the automation. */
/** Provider names come from the shared catalogue (X9); test/catalogue.test.ts keeps a message per slug. */
const PROVIDERS: ReadonlySet<string> = new Set(PROVIDER_SLUGS);

const TEMPLATE_VARIANTS: ReadonlySet<string> = new Set(["ar_egyptian", "ar_formal", "ar_gulf", "en"]);

function hrefOf(n: Note): string | null {
  if (!n.entity) return null;
  if (n.entity.type === "order") return `/orders/${n.entity.id}`;
  if (n.entity.type === "variant") return "/stock";
  if (n.entity.type === "automation") return "/automations";
  if (n.entity.type === "plan") return "/settings/usage";
  if (n.entity.type === "connection" && n.source === "whatsapp.template_fallback") return "/settings/confirmation";
  if (n.entity.type === "connection") return n.source === "connection.sync_completed" ? "/orders" : "/settings/integrations";
  return null;
}

/**
 * The team's notifications (E11-2): what automations (notify.team) and alerts send to the
 * caller's role. A bell with the unread count; the panel lists the latest, each linking to what
 * it is about; opening it marks them read. Checked every minute.
 */
const AFTER_KINDS = new Set(["confirmed", "changed", "cancelled", "no_answer", "opted_out", "customer_message", "auto_cancelled", "followup_dead"]);
const AFTER_WHY = new Set(["payment_blocks_shipping", "payment_mode_not_allowed", "address_missing", "no_courier", "courier_needs_attention", "store_not_connected", "stock_short", "stock_settling", "duplicate_suspected", "offer_settling", "order_moved"]);

export function NotificationBell() {
  const t = useTranslations("notifications");
  const tp = useTranslations("notifications.providers");
  const tv = useTranslations("confirmationSettings.whatsapp.templates.variant");
  const { api, user, store } = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();
  const key = ["notifications", user?.uid ?? "", store?.tenantId ?? ""];
  const q = useQuery({ queryKey: key, queryFn: () => ok(api.GET("/v1/notifications", { params: { query: { limit: 20 } } })), enabled: Boolean(store), refetchInterval: 60_000 });
  useSurfaceMounted("bell");
  // A row that arrived since the last read plays its catalogue outcome once (fresh); the rest are still.
  usePollMotion(q.data?.data, (n) => n.id, () => "seen", (from, _to, n) => (from === undefined ? `bell.${bellEvent(n.source, n.text) ?? "other"}` : null), { key: key.join("|") });
  const markAll = useMutation({
    mutationFn: () => ok(api.POST("/v1/notifications/read", { body: { all: true } })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", esc); };
  }, [open]);

  if (!store) return null;
  const unread = q.data?.unread ?? 0;
  const label = unread ? t("labelUnread", { count: unread }) : t("label");
  const text = (n: Note) => {
    if (n.source === "automation.paused") return t("paused", { name: n.text });
    if (n.source.startsWith("connection.")) {
      // "shopify|340|120|auth" (A3): a store's import or a connection's state, told in the reader's language.
      const [provider = "", a = "", b = "", c = ""] = n.text.split("|");
      const name = tp(PROVIDERS.has(provider) ? provider : "other");
      if (n.source === "connection.sync_completed") return t("connection.imported", { name, orders: a, products: b });
      if (n.source === "connection.sync_failed") return t("connection.importFailed", { name, orders: a });
      if (n.source === "connection.needs_attention") return t(provider === "bosta" ? "connection.courierRefused" : "connection.storeRefused", { name });
      if (n.source === "connection.disconnected") return t("connection.disconnected", { name });
      void c;
    }
    if (n.source === "after_confirmation") {
      // "blocked|#1042|no_courier" (E6-23a): what happened after confirmation, in the reader's language; the number isolated in either direction.
      const [kind = "", number = "", code = ""] = n.text.split("|");
      const num = `\u2068${number}\u2069`;
      const why = AFTER_WHY.has(code) ? t(`after.why.${code}` as "after.why.other") : t("after.why.other");
      if (kind === "blocked") return t("after.blocked", { n: num, why });
      if (AFTER_KINDS.has(kind)) return t(`after.${kind}` as "after.confirmed", { n: num });
    }
    if (n.source === "whatsapp.template_fallback") {
      // "template_fallback|ar_gulf|ar_egyptian" (E6-16d): the owner's choice is not approved yet, another went out.
      const [, chosen = "", used = ""] = n.text.split("|");
      const name = (v: string) => (TEMPLATE_VARIANTS.has(v) ? tv(v as "ar_egyptian") : v);
      return t("templateFallback", { chosen: name(chosen), used: name(used) });
    }
    if (n.source === "plan.limit") {
      // "orders|near|240|300|free": the store's plan limit (E12-1), told in the reader's language.
      const [metric, level, used, limit] = n.text.split("|");
      if ((metric === "orders" || metric === "stores" || metric === "users") && (level === "near" || level === "over")) return t(`plan.${metric}_${level}`, { used: used ?? "", limit: limit ?? "" });
    }
    return n.text;
  };
  return (
    <div className="relative" ref={box}>
      <button ref={button} type="button" aria-label={label} title={label} aria-expanded={open} aria-controls={id}
        className={buttonClass("ghost", "md", "mz-btn--icon relative")} onClick={() => { setOpen((o) => !o); if (!open && unread) markAll.mutate(); }}>
        <Icon name="notification" size={18} />
        {unread ? <span className="absolute -top-0.5 end-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-caption font-semibold text-white" data-testid="notification-count"><bdi>{unread > 99 ? "99+" : unread}</bdi></span> : null}
      </button>
      {open ? (
        <div id={id} role="region" aria-label={t("title")} className="mz-card absolute end-0 top-11 z-40 w-[min(92vw,380px)] p-0 shadow-overlay" data-testid="notifications">
          <p className="border-b border-line px-4 py-3 text-label">{t("title")}</p>
          {q.data && q.data.data.length === 0 ? <p className="px-4 py-6 text-body-sm text-text-2">{t("empty")}</p> : null}
          <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
            {(q.data?.data ?? []).map((n, i) => {
              const href = hrefOf(n);
              const body = (
                <span className="flex items-start gap-2.5">
                  <BellGlyph id={n.id} source={n.source} text={n.text} index={i} />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className={n.read ? "text-text-2" : "font-medium"}><Bdi>{text(n)}</Bdi></span>
                    <span className="text-caption text-text-3"><DateText value={n.at} /></span>
                  </span>
                </span>
              );
              return (
                <li key={n.id} className="px-4 py-2.5 text-body-sm">
                  {href ? <Link href={href} className="block hover:underline" onClick={() => setOpen(false)}>{body}</Link> : body}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/** Fresh rows play once, staggered 90 ms, at most three; the rest are the outcome's still frame. */
const BELL_STAGGER_MS = 90;
const BELL_PLAYED = 3;

/** A bell row's glyph: the outcome of the event the notification reports (catalogue), static unless fresh. */
function BellGlyph({ id, source, text, index }: { id: string; source: string; text: string; index: number }) {
  const fresh = useFresh(id);
  const type = bellEvent(source, text);
  const outcome = type ? eventMotion(type).outcome : "settle";
  const play = fresh && index < BELL_PLAYED;
  return (
    <span className="mt-0.5 text-text-2">
      <EventGlyph outcome={outcome === "quiet" ? "settle" : outcome} size={16} static={!play} style={play ? { animationDelay: `${index * BELL_STAGGER_MS}ms` } : undefined} />
    </span>
  );
}
