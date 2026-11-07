import type { ReactNode } from "react";

/**
 * Rich-text tags shared by every message (docs/16 §1.4, FX-1). `<l>…</l>` marks a Latin word an
 * Arabic sentence has to keep (a menu name in another product, a code, a file type, a CSV header):
 * it is isolated in <bdi>, so it reads in its own direction and an Arabic page carries no bare Latin.
 * Brand names are written in Arabic instead ("شوبيفاي", as the catalogue says them).
 * Use: `t.rich("key", latin)` or `t.rich("key", { ...latin, n: … })`.
 */
export const latin = { l: (chunks: ReactNode) => <bdi>{chunks}</bdi> };
