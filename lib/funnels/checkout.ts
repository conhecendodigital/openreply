/**
 * Etapa 6: the URL the checkout button opens. Browser-safe and pure.
 *
 * - Tracking params of the visit (utm_*, fbclid, gclid, src, sck) override
 *   the same keys in the destination; other destination params stay.
 * - Never forwards the contact token (c) nor any param outside the list.
 * - Hotmart: xcod=<visitorId> (links the purchase webhook back to the visit)
 *   and an sck built from utm_source + utm_campaign when there is none.
 */
import type { TrackingParams } from "@/lib/funnels/types";
import { isHttpsUrl } from "@/lib/funnels/media";

export const PASS_THROUGH_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "fbclid",
  "gclid",
  "src",
  "sck",
] as const;
export const HOTMART_HOSTS = ["pay.hotmart.com", "go.hotmart.com"];
export const KNOWN_CHECKOUT_HOSTS = [
  ...HOTMART_HOSTS,
  "hotmart.com",
  "pay.kiwify.com.br",
  "kiwify.app",
  "checkout.eduzz.com",
  "sun.eduzz.com",
];
const MAX_PARAM = 200;

export function isHotmartHost(host: string): boolean {
  return HOTMART_HOSTS.includes(host.toLowerCase());
}

export function isKnownCheckoutHost(host: string): boolean {
  const h = host.toLowerCase();
  return KNOWN_CHECKOUT_HOSTS.some((k) => h === k || h.endsWith(`.${k}`));
}

/** Only the pass-through keys, trimmed, capped at 200 characters. */
export function pickTrackingParams(
  source: Record<string, unknown> | URLSearchParams | null | undefined
): TrackingParams {
  const out: TrackingParams = {};
  if (!source) return out;
  for (const key of PASS_THROUGH_PARAMS) {
    const raw = source instanceof URLSearchParams ? source.get(key) : source[key];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (typeof value === "string" && value.trim()) out[key] = value.trim().slice(0, MAX_PARAM);
  }
  return out;
}

export function buildCheckoutUrl(
  destination: string,
  entryParams: TrackingParams,
  opts: { visitorId?: string } = {}
): string | null {
  if (!destination || !isHttpsUrl(destination)) return null;
  const url = new URL(destination.trim());
  const entry = pickTrackingParams(entryParams as Record<string, unknown>);
  for (const key of PASS_THROUGH_PARAMS) {
    const value = entry[key];
    if (value) url.searchParams.set(key, value);
  }
  if (isHotmartHost(url.hostname)) {
    if (opts.visitorId && !url.searchParams.get("xcod")) {
      url.searchParams.set("xcod", opts.visitorId.slice(0, MAX_PARAM));
    }
    if (!url.searchParams.get("sck") && entry.utm_source) {
      const sck = `${entry.utm_source}_${entry.utm_campaign ?? ""}`
        .replace(/[^A-Za-z0-9_-]/g, "")
        .slice(0, 100)
        .replace(/_+$/g, "");
      if (sck) url.searchParams.set("sck", sck);
    }
  }
  return url.toString();
}
