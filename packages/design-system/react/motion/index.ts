/**
 * @mizan/design-system/react/motion: Brand 2.0 as React components ('use client', SSR-safe). No
 * strings inside: copy arrives in props (the apps build it with next-intl). Screens never pick an
 * animation: surfaces map an event type or a state to these through the catalogue in @mizan/shared.
 */
export { MizanLoader, type MizanLoaderProps } from "./MizanLoader";
export { Mark, Wordmark, ThemedWordmark, Lockup, Bilingual, type LogoProps, type LogoTone } from "./Mark";
export { EventGlyph, type EventGlyphProps } from "./EventGlyph";
export { DoneState, type DoneStateProps } from "./DoneState";
export { RedBudgetProvider, RedSwatch, useRed, useRedBudget, useRedTaken } from "./RedBudget";
export { useReducedMotion } from "./useReducedMotion";
export { useMotionClock, useSvgId, type PhysicsModule } from "./useMotionClock";
