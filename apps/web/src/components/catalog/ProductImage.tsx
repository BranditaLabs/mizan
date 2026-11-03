"use client";

import { Icon } from "@mizan/design-system/icons/react";
import { useState } from "react";
import { cx } from "@/components/ui/logic";

type Image = { url: string; thumbUrl?: string | null; alt: string | null; width: number | null; height: number | null };

/**
 * A product picture from the store's CDN (P1). Store pictures live on Shopify's CDN or the
 * WooCommerce site itself, so the request carries no referrer and the picture loads lazily. A
 * missing or broken picture shows the product icon in the same box, so rows never jump.
 */
export function ProductImage({ image, alt, size = 48, className }: { image: Image | null | undefined; alt: string; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const box = cx("relative shrink-0 overflow-hidden rounded-md border border-line bg-surface-sunk", className);
  if (!image || broken) {
    return (
      <span className={cx(box, "inline-flex items-center justify-center text-text-3")} style={{ width: size, height: size }} aria-hidden="true">
        <Icon name="product" size={Math.max(16, Math.round(size / 2.5))} />
      </span>
    );
  }
  return (
    <span className={box} style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- store CDN pictures: not optimised through Next */}
      <img src={size <= 160 && image.thumbUrl ? image.thumbUrl : image.url} alt={image.alt || alt} width={image.width ?? size} height={image.height ?? size} loading="lazy" decoding="async"
        referrerPolicy="no-referrer" onError={() => setBroken(true)} className="h-full w-full object-cover" />
    </span>
  );
}
