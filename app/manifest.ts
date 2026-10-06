import type { MetadataRoute } from "next";

// Lets a self-hosted instance be installed to the home screen: on iOS via
// Share -> "Add to Home Screen", on Android through the install prompt. It then
// opens standalone, without browser chrome, which makes checking campaigns from
// a phone practical.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lead Engine",
    short_name: "Lead Engine",
    description: "Automação de Instagram, Direct e quiz",
    start_url: "/overview",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
