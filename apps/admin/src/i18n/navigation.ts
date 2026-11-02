import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

/** Locale-aware Link, router and pathname helpers. */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
