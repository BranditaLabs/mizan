import type { MetadataRoute } from "next";

/** Installable web app (design system app icons; colours are the brand ink and paper). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mizan · ميزان",
    short_name: "Mizan",
    start_url: "/",
    display: "standalone",
    background_color: "#FEF7FF",
    theme_color: "#0B0B0B",
    icons: [
      { src: "/brand/mizan-appicon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/mizan-appicon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
