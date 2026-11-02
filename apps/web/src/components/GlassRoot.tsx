"use client";

import { useLocale } from "next-intl";
import { useSyncExternalStore, type PointerEvent, type ReactNode } from "react";
import { subscribeTheme, type Theme } from "@/lib/theme";

const DARK = "(prefers-color-scheme: dark)";

function subscribe(cb: () => void) {
  const q = window.matchMedia(DARK);
  q.addEventListener("change", cb);
  const off = subscribeTheme(cb);
  return () => { q.removeEventListener("change", cb); off(); };
}
/** Light under the pointer on glass cards (glass-bridge.css): one listener for the whole root. */
function spotlight(e: PointerEvent<HTMLDivElement>) {
  if (e.pointerType !== "mouse") return;
  const card = (e.target as Element).closest?.<HTMLElement>(".mz-card");
  if (!card) return;
  const r = card.getBoundingClientRect();
  card.style.setProperty("--mx", `${e.clientX - r.left}px`);
  card.style.setProperty("--my", `${e.clientY - r.top}px`);
}

/** The theme in force: the person's choice, else the system's. */
const isLight = () => {
  const chosen = document.documentElement.dataset.theme;
  return chosen ? chosen === "light" : !window.matchMedia(DARK).matches;
};

/**
 * The Mizan Glass root (packages/design-system/css/glass.css, docs/glass.md): the theme's glass
 * tokens for everything inside (the core tokens are bridged by glass-bridge.css), the reading
 * direction, and the light fields that drift behind the glass. `ink`: an island that stays dark glass
 * whatever the theme (the dashboard hero, the sign-in brand side), without fields of its own unless
 * asked.
 */
export function GlassRoot({ children, theme = "system", ink = false, fields = !ink, className = "" }: {
  children: ReactNode; theme?: Theme; ink?: boolean; fields?: boolean; className?: string;
}) {
  const dir = useLocale() === "ar" ? "rtl" : "ltr";
  const light = useSyncExternalStore(subscribe, isLight, () => theme === "light");
  return (
    <div className={`mzg ${light && !ink ? "light" : ""} ${className}`} dir={dir} onPointerMove={ink ? undefined : spotlight}>
      {fields ? (
        <div className="fields" aria-hidden="true"><i className="f1" /><i className="f2" /><i className="f3" /><div className="dots" /></div>
      ) : null}
      {children}
    </div>
  );
}
