"use client";

import { useState } from "react";

/**
 * The store's mark: its logo from Shopify, or its first letter when none was read (or it fails to
 * load). Decorative next to the store's name, so no alt text of its own.
 */
export function StoreMark({ name, logo, size = 28, rail = false }: { name: string; logo: string | null | undefined; size?: number; rail?: boolean }) {
  const [broken, setBroken] = useState(false);
  const box = { width: size, height: size };
  if (logo && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- the store's CDN, any host: next/image would need each one listed
      <img src={logo} alt="" aria-hidden="true" style={box} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)}
        className={`shrink-0 rounded-sm object-contain ${rail ? "bg-rail-surface" : "bg-surface-sunk"}`} />
    );
  }
  return (
    <span aria-hidden="true" style={box}
      className={`inline-flex shrink-0 items-center justify-center rounded-sm text-label ${rail ? "bg-rail-surface text-rail-text-2" : "bg-surface-sunk text-text-2"}`}>
      {Array.from(name.trim())[0]?.toUpperCase() ?? ""}
    </span>
  );
}
