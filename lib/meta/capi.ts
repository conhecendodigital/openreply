/**
 * Meta Conversions API (CAPI): the server side copy of the Pixel events
 * (server-only).
 *
 * - Config per workspace in MetaCapiSettings: default Pixel id, access token
 *   (stored ONLY encrypted, AES-256-GCM from lib/meta/oauth.ts) and an
 *   optional test_event_code. The token never leaves this file in clear: no
 *   API, log or page gets it back.
 * - sendCapiEvent never throws. Short timeout. A failure becomes a console
 *   warning plus an OperationalEvent (SYSTEM, WARNING), never with the token.
 * - user_data: e-mail, phone, name and external_id hashed with SHA-256 after
 *   normalizing; IP, user agent, fbc and fbp go as they are (Meta's rule).
 * - event_id is the same one the browser Pixel used (eventID), so Meta
 *   counts the event once.
 * - event_source_url carries no personal data: only the public page address,
 *   without query string.
 */
import { createHash, randomBytes } from "node:crypto";
import { after } from "next/server";
import { prisma } from "@/lib/db/client";
import { getBaseUrl, getMetaGraphApiVersion } from "@/lib/env";
import { decryptToken } from "@/lib/meta/oauth";

export const CAPI_TIMEOUT_MS = 4000;
export const PIXEL_ID_RE = /^\d{5,20}$/;
/** Meta access tokens: letters and digits (EAA...). */
export const CAPI_TOKEN_RE = /^[A-Za-z0-9_-]{20,1024}$/;
export const TEST_EVENT_CODE_RE = /^[A-Za-z0-9_-]{2,60}$/;
export const EVENT_ID_RE = /^[A-Za-z0-9_.-]{8,80}$/;
export const FBP_RE = /^fb\.\d\.\d{10,16}\.\d{1,30}$/;
export const FBC_RE = /^fb\.\d\.\d{10,16}\.[A-Za-z0-9_-]{4,500}$/;

export type CapiEventName = "PageView" | "Lead" | "InitiateCheckout" | "Purchase";

/** What a workspace has saved (the token still encrypted). */
export type StoredCapiSettings = {
  pixelId: string | null;
  accessTokenEnc: string | null;
  testEventCode: string | null;
};

export type CapiUserInput = {
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  externalId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  fbc?: string | null;
  fbp?: string | null;
};

export type CapiEventInput = {
  eventName: CapiEventName;
  eventId: string;
  eventTime?: Date;
  eventSourceUrl?: string | null;
  user: CapiUserInput;
  customData?: { value?: number; currency?: string; content_name?: string };
};

export type CapiErrorCode =
  | "not_configured"
  | "invalid_token"
  | "pixel_not_found"
  | "permission"
  | "rejected"
  | "timeout"
  | "network";

export type CapiResult =
  | { ok: true; eventsReceived: number; fbtraceId?: string }
  | { ok: false; code: CapiErrorCode; message?: string };

// ─── Normalizing and hashing ────────────────────────────────────────────────

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function normalizeCapiEmail(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().toLowerCase();
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? v : null;
}

/** Digits only, with country code. 10 or 11 digits = Brazil without 55. */
export function normalizeCapiPhone(value: string | null | undefined): string | null {
  let d = (value ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  return d.length >= 8 && d.length <= 15 ? d : null;
}

function normalizeNamePart(value: string | undefined): string | null {
  const v = (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return v || null;
}

/** First and last name, lowercase, no accents, letters only. */
export function splitName(value: string | null | undefined): { fn: string | null; ln: string | null } {
  const parts = (value ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { fn: null, ln: null };
  return { fn: normalizeNamePart(parts[0]), ln: parts.length > 1 ? normalizeNamePart(parts[parts.length - 1]) : null };
}

/** fbc built from the fbclid of the entry link: fb.1.<ms>.<fbclid>. */
export function fbcFromFbclid(fbclid: string | null | undefined, at: Date | number): string | null {
  const id = (fbclid ?? "").trim();
  if (!id || !/^[A-Za-z0-9_-]{4,500}$/.test(id)) return null;
  const ms = typeof at === "number" ? at : at.getTime();
  return `fb.1.${Math.floor(ms)}.${id}`;
}

export function validFbp(value: unknown): string | null {
  return typeof value === "string" && FBP_RE.test(value) ? value : null;
}

export function validFbc(value: unknown): string | null {
  return typeof value === "string" && FBC_RE.test(value) ? value : null;
}

export function newEventId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

type UserData = Record<string, string | string[]>;

export function buildUserData(user: CapiUserInput): UserData {
  const out: UserData = {};
  const em = normalizeCapiEmail(user.email);
  if (em) out.em = [sha256(em)];
  const ph = normalizeCapiPhone(user.phone);
  if (ph) out.ph = [sha256(ph)];
  const { fn, ln } = splitName(user.name);
  if (fn) out.fn = [sha256(fn)];
  if (ln) out.ln = [sha256(ln)];
  const ext = (user.externalId ?? "").trim();
  if (ext) out.external_id = [sha256(ext)];
  if (user.ip) out.client_ip_address = user.ip.slice(0, 64);
  if (user.userAgent) out.client_user_agent = user.userAgent.slice(0, 500);
  const fbc = validFbc(user.fbc);
  if (fbc) out.fbc = fbc;
  const fbp = validFbp(user.fbp);
  if (fbp) out.fbp = fbp;
  return out;
}

/** Public address of the quiz, no query string (no personal data). */
export function quizSourceUrl(slug: string): string {
  return `${getBaseUrl().replace(/\/$/, "")}/q/${encodeURIComponent(slug)}`;
}

// ─── Config ─────────────────────────────────────────────────────────────────

export function isCapiReady(settings: StoredCapiSettings | null | undefined, pixelId?: string | null): boolean {
  const pixel = pixelId ?? settings?.pixelId ?? null;
  return Boolean(settings?.accessTokenEnc && pixel && PIXEL_ID_RE.test(pixel));
}

export async function getCapiSettings(workspaceId: string): Promise<StoredCapiSettings | null> {
  try {
    const row = await prisma.metaCapiSettings.findUnique({
      where: { workspaceId },
      select: { pixelId: true, accessTokenEnc: true, testEventCode: true },
    });
    return row ?? null;
  } catch {
    return null;
  }
}

// ─── Sending ────────────────────────────────────────────────────────────────

function eventTimeOf(at: Date | undefined): number {
  const now = Date.now();
  const t = at ? at.getTime() : now;
  // Meta refuses events from the future or older than 7 days.
  if (!Number.isFinite(t) || t > now || now - t > 6 * 24 * 3600 * 1000) return Math.floor(now / 1000);
  return Math.floor(t / 1000);
}

function scrub(text: string, secret: string | null): string {
  let out = text.slice(0, 300);
  if (secret) out = out.split(secret).join("•••");
  return out.replace(/access_token=[^&\s]+/gi, "access_token=•••");
}

export function classifyMetaError(err: { code?: number; error_subcode?: number; message?: string; type?: string } | null | undefined): CapiErrorCode {
  const code = err?.code;
  const msg = (err?.message ?? "").toLowerCase();
  if (code === 190 || code === 102 || msg.includes("access token")) return "invalid_token";
  if (code === 10 || code === 200 || code === 3 || (typeof code === "number" && code >= 200 && code < 300)) return "permission";
  if (code === 100 && (msg.includes("does not exist") || msg.includes("unsupported post request") || msg.includes("object with id"))) {
    return "pixel_not_found";
  }
  return "rejected";
}

async function logFailure(workspaceId: string | null, eventName: string, result: Extract<CapiResult, { ok: false }>) {
  console.warn(`[Meta CAPI] ${eventName} failed: ${result.code}`);
  try {
    await prisma.operationalEvent.create({
      data: {
        workspaceId,
        source: "SYSTEM",
        level: "WARNING",
        message: `Meta CAPI: ${eventName} não foi aceito (${result.code})`,
        payload: { eventName, code: result.code, ...(result.message ? { message: result.message } : {}) },
      },
    });
  } catch {
    // Logging never breaks anything.
  }
}

/**
 * Sends one event. Never throws. `settings` comes from getCapiSettings;
 * `pixelId` overrides the account Pixel (a quiz with its own Pixel).
 */
export async function sendCapiEvent(
  settings: StoredCapiSettings | null | undefined,
  input: CapiEventInput,
  opts: { workspaceId?: string | null; pixelId?: string | null; testEventCode?: string | null; log?: boolean } = {}
): Promise<CapiResult> {
  const pixelId = opts.pixelId ?? settings?.pixelId ?? null;
  if (!settings?.accessTokenEnc || !pixelId || !PIXEL_ID_RE.test(pixelId)) return { ok: false, code: "not_configured" };

  let token: string | null = null;
  try {
    token = decryptToken(settings.accessTokenEnc);
  } catch {
    const r: CapiResult = { ok: false, code: "not_configured" };
    if (opts.log !== false) await logFailure(opts.workspaceId ?? null, input.eventName, r);
    return r;
  }

  const event: Record<string, unknown> = {
    event_name: input.eventName,
    event_time: eventTimeOf(input.eventTime),
    event_id: input.eventId,
    action_source: "website",
    user_data: buildUserData(input.user),
  };
  if (input.eventSourceUrl) event.event_source_url = input.eventSourceUrl;
  if (input.customData && Object.keys(input.customData).length > 0) event.custom_data = input.customData;

  const body: Record<string, unknown> = { data: [event] };
  const testCode = opts.testEventCode !== undefined ? opts.testEventCode : settings.testEventCode;
  if (testCode) body.test_event_code = testCode;

  const url = `https://graph.facebook.com/${getMetaGraphApiVersion()}/${pixelId}/events`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CAPI_TIMEOUT_MS);
  let result: CapiResult;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });
    const payload = (await res.json().catch(() => null)) as
      | { events_received?: number; fbtrace_id?: string; error?: { code?: number; error_subcode?: number; message?: string; error_user_msg?: string } }
      | null;
    if (res.ok && payload && typeof payload.events_received === "number") {
      result = { ok: true, eventsReceived: payload.events_received, ...(payload.fbtrace_id ? { fbtraceId: payload.fbtrace_id } : {}) };
    } else {
      const err = payload?.error;
      const raw = err?.error_user_msg || err?.message || `HTTP ${res.status}`;
      result = { ok: false, code: classifyMetaError(err), message: scrub(raw, token) };
    }
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    result = { ok: false, code: aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
  if (!result.ok && opts.log !== false) await logFailure(opts.workspaceId ?? null, input.eventName, result);
  return result;
}

/**
 * Runs the send after the response (Next `after`), so the visitor never waits
 * for Meta. Outside a request (scripts, tests) it just starts the promise.
 */
export function scheduleCapi(task: () => Promise<unknown>): void {
  const run = () => task().catch(() => undefined);
  try {
    after(run);
  } catch {
    void run();
  }
}
