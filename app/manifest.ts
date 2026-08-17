import type { MetadataRoute } from "next";

const SITE_NAME = process.env.NEXT_PUBLIC_SITE_NAME || "Checkmate Coach";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — automated coach reports for junior chess players`,
    short_name: "Checkmate Coach",
    description:
      "Plain-language progress reports for your junior chess player, built from their own games.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#047857",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
