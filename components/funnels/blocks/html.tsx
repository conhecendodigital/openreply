"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { HtmlBlock } from "@/lib/funnels/types";

/**
 * The owner's own page. It lives in an iframe with an opaque origin (sandbox
 * without allow-same-origin) and its own CSP (no network, https images only),
 * so it cannot read the quiz, cookies or answers. Links open in a new tab.
 * The page can tell its height: parent.postMessage({ fqHeight: n }, "*").
 */
const FRAME_CSP =
  "default-src 'none'; img-src https: data:; media-src https:; font-src https: data:; style-src 'unsafe-inline' https:; script-src 'unsafe-inline'; form-action 'none'";

const HEIGHT_SCRIPT = `<script>(function(){function s(){try{parent.postMessage({fqHeight:Math.ceil(document.documentElement.scrollHeight)},"*")}catch(e){}}addEventListener("load",s);addEventListener("resize",s);if(window.ResizeObserver)new ResizeObserver(s).observe(document.documentElement);setInterval(s,1000)})()</script>`;

export function buildFrameDoc(html: string): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${FRAME_CSP}">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><base target="_blank">` +
    `<style>html,body{margin:0}body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}</style></head>` +
    `<body>${html}${HEIGHT_SCRIPT}</body></html>`
  );
}

export default function HtmlView({ block }: { block: HtmlBlock }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(block.height ?? 600);
  const doc = useMemo(() => buildFrameDoc(block.html), [block.html]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== ref.current?.contentWindow) return;
      const h = (e.data as { fqHeight?: unknown } | null)?.fqHeight;
      if (typeof h === "number" && Number.isFinite(h)) setHeight(Math.min(4000, Math.max(80, Math.round(h))));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (!block.html.trim()) return null;
  return (
    <iframe
      ref={ref}
      title="Conteúdo"
      srcDoc={doc}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
      referrerPolicy="no-referrer"
      loading="lazy"
      scrolling="no"
      className="w-full border-0"
      style={{ height, display: "block", background: "transparent" }}
    />
  );
}
