import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { LangProvider } from "@/components/lang-provider";
import { getLang } from "@/lib/i18n/server";

const SITE_URL = process.env.NEXTAUTH_URL || "https://many.leadenginer.com";
const DESCRICAO = "Automação de Instagram, Direct e quiz pela API oficial da Meta.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Lead Engine - Automação de comentário pra DM no Instagram",
  description: DESCRICAO,
  applicationName: "Lead Engine",
  openGraph: {
    type: "website",
    siteName: "Lead Engine",
    title: "Lead Engine",
    description: DESCRICAO,
    locale: "pt_BR",
    images: [{ url: "/og-lead-engine.png", width: 1200, height: 630, alt: "Lead Engine" }],
  },
  twitter: { card: "summary_large_image", title: "Lead Engine", description: DESCRICAO, images: ["/og-lead-engine.png"] },
  keywords: [
    "instagram automation",
    "comment to DM",
    "instagram private replies",
    "social commerce",
    "manychat alternative",
  ],
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Lead Engine",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  width: "device-width",
  initialScale: 1,
  // Installed on iOS the app owns the full screen, notch included; the safe
  // area insets below keep content clear of the system UI.
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const lang = await getLang();
  return (
    <html lang={lang === "pt" ? "pt-BR" : "en"} className="h-full">
      <body
        className="min-h-full bg-background text-foreground font-sans antialiased"
        // Clears the home indicator when installed; 0 everywhere else.
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <LangProvider lang={lang}>{children}</LangProvider>
        <Analytics />
      </body>
    </html>
  );
}
