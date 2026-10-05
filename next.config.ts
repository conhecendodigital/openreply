import type { NextConfig } from "next";

/**
 * Security headers on every response. Kept conservative on purpose: the CSP
 * only forbids framing, plugins and <base> tricks, so it cannot block the
 * Instagram/Meta CDN images, Next's inline scripts or the login e-mail flow.
 * A stricter script/img policy needs nonces and a test pass in production.
 */
export const SECURITY_HEADERS = [
  // The panel has "turn on", "send broadcast" and "approve" buttons: never
  // let another site frame it (clickjacking).
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/**
 * Etapa 6: the public quiz pages (/q/<slug>) get a CLOSED frame policy: an
 * iframe there can only be the video hosts we build embeds for (YouTube
 * nocookie, Vimeo, Panda Video) and Facebook (Pixel). No script-src /
 * connect-src: the Pixel (connect.facebook.net) and Next's scripts keep
 * working. Same key on a later rule replaces the general CSP for /q.
 */
export const PUBLIC_FUNNEL_CSP =
  "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'; " +
  "frame-src https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com https://*.pandavideo.com.br https://www.facebook.com";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // Do not advertise the framework (x-powered-by: Next.js).
  poweredByHeader: false,
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/q/:path*", headers: [{ key: "Content-Security-Policy", value: PUBLIC_FUNNEL_CSP }] },
    ];
  },
};

export default nextConfig;
