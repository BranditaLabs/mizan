import localFont from "next/font/local";

/**
 * Self-hosted fonts (docs/08 §2), subset woff2 files from Fontsource (OFL, licences in
 * src/fonts). Local files: no Google request at build or run time. next/font needs literals.
 */
export const plexArabic = localFont({
  variable: "--font-plex-arabic",
  display: "swap",
  src: [
    { path: "../fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../fonts/ibm-plex-sans-arabic-arabic-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../fonts/ibm-plex-sans-arabic-arabic-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../fonts/ibm-plex-sans-arabic-arabic-700-normal.woff2", weight: "700", style: "normal" },
  ],
});

export const plex = localFont({
  variable: "--font-plex",
  display: "swap",
  src: [
    { path: "../fonts/ibm-plex-sans-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../fonts/ibm-plex-sans-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../fonts/ibm-plex-sans-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../fonts/ibm-plex-sans-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
});

export const plexMono = localFont({
  variable: "--font-plex-mono",
  display: "swap",
  src: [
    { path: "../fonts/ibm-plex-mono-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../fonts/ibm-plex-mono-latin-500-normal.woff2", weight: "500", style: "normal" },
  ],
});

export const bricolage = localFont({
  variable: "--font-bricolage",
  display: "swap",
  src: [
    { path: "../fonts/bricolage-grotesque-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../fonts/bricolage-grotesque-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
});

export const fontVariables = [plexArabic, plex, plexMono, bricolage].map((f) => f.variable).join(" ");
