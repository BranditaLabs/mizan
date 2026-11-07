import type { CSSProperties } from "react";

/**
 * The Brand 2.0 marks as images from the app's /brand folder (copied there by build-png.mjs).
 *   tone="ink"    the full-colour file, for paper backgrounds
 *   tone="paper"  the -on-ink file, for ink backgrounds
 *   tone="auto"   both, and the theme shows the one that matches (data-theme, else the system)
 *   tone="mono"   one colour (-mono-ink / -mono-paper by theme): the app chrome, so the content owns the red
 * No strings inside: the caller passes `alt` (t("logoAlt")).
 */
export type LogoTone = "auto" | "ink" | "paper" | "mono";
export interface LogoProps { alt: string; tone?: LogoTone; height?: number | string; base?: string; className?: string; style?: CSSProperties }

function Logo({ name, alt, tone = "auto", height, base = "/brand", className = "", style }: LogoProps & { name: string }) {
  const css: CSSProperties = { height, width: "auto", ...style };
  const src = (variant: string) => `${base}/${name}${variant}.svg`;
  if (tone === "ink" || tone === "paper") {
    // eslint-disable-next-line @next/next/no-img-element -- static brand SVG
    return <img src={src(tone === "paper" ? "-on-ink" : "")} alt={alt} className={className} style={css} />;
  }
  const [light, dark] = tone === "mono" ? ["-mono-ink", "-mono-paper"] : ["", "-on-ink"];
  return (
    <span className={`mz-logo ${className}`} style={{ display: "inline-flex", lineHeight: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG */}
      <img src={src(light)} alt={alt} className="mz-logo-light" style={css} />
      {/* eslint-disable-next-line @next/next/no-img-element -- static brand SVG */}
      <img src={src(dark)} alt={alt} className="mz-logo-dark" style={css} />
    </span>
  );
}

/** The two-ball mark: ink left, red right. */
export const Mark = (p: LogoProps) => <Logo name="mizan-mark" {...p} />;
/** The wordmark in the page's script: Arabic for an `ar*` locale, else Latin. */
export const Wordmark = ({ locale, ...p }: LogoProps & { locale: string }) => <Logo name={locale.startsWith("ar") ? "mizan-wordmark-ar" : "mizan-wordmark"} {...p} />;
/** The wordmark that follows the theme (tone="auto"). */
export const ThemedWordmark = (p: Omit<LogoProps, "tone"> & { locale: string }) => <Wordmark {...p} tone="auto" />;
/** Mark and wordmark together. */
export const Lockup = (p: LogoProps) => <Logo name="mizan-lockup" {...p} />;
/** mizan · ميزان, both scripts. */
export const Bilingual = (p: LogoProps) => <Logo name="mizan-bilingual" {...p} />;
