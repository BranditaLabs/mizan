"use client";

import { createContext, useContext, useSyncExternalStore, type ReactNode } from "react";
import { currentTheme, subscribeTheme, type Theme } from "@/lib/theme";

/**
 * The one theme source (docs/16 §4, FX-1): the cookie the server read, then the person's choice in
 * lib/theme (chooseTheme). `<html data-theme>`, GlassRoot's light/dark glass and every theme switch
 * read it from here, so they can never disagree (before, GlassRoot read `data-theme` and the
 * switches read the cookie, and a GlassRoot without a `theme` prop rendered dark on the server).
 */
const Initial = createContext<Theme>("system");

export function ThemeProvider({ initial, children }: { initial: Theme; children: ReactNode }) {
  return <Initial.Provider value={initial}>{children}</Initial.Provider>;
}

/** The chosen theme (light, dark or system): the server's cookie until the browser takes over. */
export function useTheme(): Theme {
  const initial = useContext(Initial);
  return useSyncExternalStore(subscribeTheme, currentTheme, () => initial);
}
