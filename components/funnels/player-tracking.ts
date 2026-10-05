/**
 * Etapa 6 (Quiz): what the public page sends from the browser. Only used in
 * mode "live" (the preview and the editor never record anything).
 *
 *  - visitorId: 32 hex from crypto.getRandomValues, kept in localStorage per
 *    funnel (memory fallback when storage is blocked). It goes to the Hotmart
 *    checkout as xcod, so the purchase webhook finds the visit.
 *  - Events: POST /api/q/<slug>/event with keepalive (the server dedupes).
 *  - Meta Pixel: the standard fbevents.js loader, written here with the
 *    validated numeric id. Nothing the owner pastes is ever run.
 */

import type { FunnelEventBody, FunnelLeadBody, FunnelPublicOk } from "@/lib/funnels/types";

const memory = new Map<string, string>();

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function storageSet(key: string, value: string) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Blocked storage (private window): the memory copy lasts this visit.
  }
}

export function randomVisitorId(): string {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function getVisitorId(funnelId: string): string {
  const key = `le_q_${funnelId}`;
  const saved = storageGet(key) ?? memory.get(key) ?? null;
  if (saved && /^[a-f0-9]{32}$/.test(saved)) return saved;
  const id = randomVisitorId();
  storageSet(key, id);
  return id;
}

export const CONSENT_KEY = "le_q_consent";
export type ConsentChoice = "accepted" | "declined" | "seen";

export function readConsent(): ConsentChoice | null {
  const v = storageGet(CONSENT_KEY) ?? memory.get(CONSENT_KEY) ?? null;
  return v === "accepted" || v === "declined" || v === "seen" ? v : null;
}

export function saveConsent(choice: ConsentChoice) {
  storageSet(CONSENT_KEY, choice);
}

export function sendFunnelEvent(slug: string, body: FunnelEventBody): void {
  try {
    void fetch(`/api/q/${encodeURIComponent(slug)}/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
      credentials: "omit",
    }).catch(() => undefined);
  } catch {
    // Tracking never breaks the quiz.
  }
}

export type LeadSubmitResult = { ok: true } | { ok: false; code: string | null };

export async function submitFunnelLead(slug: string, body: FunnelLeadBody): Promise<LeadSubmitResult> {
  try {
    const res = await fetch(`/api/q/${encodeURIComponent(slug)}/lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "omit",
    });
    const payload = (await res.json().catch(() => null)) as
      | { success: true; data: FunnelPublicOk }
      | { success: false; details?: { code?: string } }
      | null;
    if (res.ok && payload && payload.success) return { ok: true };
    return { ok: false, code: (payload && !payload.success && payload.details?.code) || (res.status === 429 ? "rate_limited" : null) };
  } catch {
    return { ok: false, code: "network" };
  }
}

// ─── Meta Pixel ─────────────────────────────────────────────────────────────

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...a: unknown[]) => void; queue: unknown[][]; push: unknown; loaded: boolean; version: string };
type PixelWindow = Window & { fbq?: Fbq; _fbq?: Fbq };

export const PIXEL_ID_RE = /^\d{5,20}$/;
let pixelReady = false;

/** Loads fbevents.js once, inits the id and sends PageView. Ignores invalid ids. */
export function loadPixel(pixelId: string): boolean {
  if (typeof window === "undefined" || !PIXEL_ID_RE.test(pixelId)) return false;
  if (pixelReady) return true;
  const w = window as PixelWindow;
  if (!w.fbq) {
    const fbq = function (...args: unknown[]) {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue.push(args);
    } as Fbq;
    fbq.queue = [];
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = "2.0";
    w.fbq = fbq;
    if (!w._fbq) w._fbq = fbq;
    const script = document.createElement("script");
    script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(script);
  }
  w.fbq?.("init", pixelId);
  w.fbq?.("track", "PageView");
  pixelReady = true;
  return true;
}

/** eventID = the same event_id the server sends to the Conversions API (Meta counts once). */
export function pixelTrack(event: "ViewContent" | "Lead" | "InitiateCheckout", eventId?: string): void {
  if (!pixelReady) return;
  if (eventId) (window as PixelWindow).fbq?.("track", event, {}, { eventID: eventId });
  else (window as PixelWindow).fbq?.("track", event);
}

/** Id shared by the Pixel (eventID) and the Conversions API (event_id). */
export function newEventId(prefix: "lead" | "ic"): string {
  return `${prefix}_${randomVisitorId().slice(0, 16)}`;
}

/** The Pixel cookies _fbp and _fbc, when the Pixel already set them. */
export function readPixelCookies(): { fbp?: string; fbc?: string } {
  if (typeof document === "undefined") return {};
  const out: { fbp?: string; fbc?: string } = {};
  try {
    for (const part of document.cookie.split(";")) {
      const [k, ...rest] = part.trim().split("=");
      const v = decodeURIComponent(rest.join("=") || "");
      if (k === "_fbp" && /^fb\.\d\.\d+\.\d+$/.test(v)) out.fbp = v.slice(0, 100);
      if (k === "_fbc" && /^fb\.\d\.\d+\.[A-Za-z0-9_-]+$/.test(v)) out.fbc = v.slice(0, 600);
    }
  } catch {
    // Blocked cookies: the server builds fbc from the fbclid.
  }
  return out;
}

export function pixelCustom(event: string, data: Record<string, string | number>): void {
  if (!pixelReady) return;
  (window as PixelWindow).fbq?.("trackCustom", event, data);
}
