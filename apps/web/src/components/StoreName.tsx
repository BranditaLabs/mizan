"use client";

import { useSession } from "@/lib/session";

/** The current store's name (data, not copy: shown as typed by its owner). */
export function StoreName({ className = "" }: { className?: string }) {
  const { store } = useSession();
  return <p className={className} data-testid="store-name">{store?.tenantName}</p>;
}
