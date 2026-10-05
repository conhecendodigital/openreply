/**
 * Etapa 6: request limits of the public funnel APIs and the Hotmart webhook.
 * Enforced with hitRateLimit (lib/http-rate-limit.ts), which fails open.
 */
/** Events per IP + funnel per minute (a visitor sends a few per screen). */
export const FUNNEL_EVENT_LIMIT = { limit: 120, windowSeconds: 60 };
/** Lead submissions per IP per 10 minutes. */
export const FUNNEL_LEAD_LIMIT = { limit: 10, windowSeconds: 600 };
/** Body of /api/q/... (bytes). */
export const MAX_PUBLIC_BODY = 8_192;
/** Body of the Hotmart webhook (bytes). */
export const MAX_HOTMART_BODY = 262_144;

/**
 * The request body as text, or "too_large" past `max` bytes (checked on the
 * Content-Length first, then on what really arrived).
 */
export async function readLimitedText(request: Request, max: number): Promise<string | "too_large"> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) return "too_large";
  let text: string;
  try {
    text = await request.text();
  } catch {
    return "";
  }
  return new TextEncoder().encode(text).length > max ? "too_large" : text;
}

export function parseJsonText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Body of the panel/MCP routes that carry a whole draft (bytes): the draft cap plus room for name, slug and patches. */
export const MAX_PANEL_BODY = 262_144;

/** Sentinel returned by readFunnelJson for a body over the cap. */
export const TOO_LARGE: unique symbol = Symbol("too_large");

/**
 * JSON body of a panel/MCP funnel route, refused past MAX_PANEL_BODY before
 * parsing. null = empty or not JSON (the route's zod check answers 400, as
 * with readJson).
 */
export async function readFunnelJson(request: Request): Promise<unknown> {
  const text = await readLimitedText(request, MAX_PANEL_BODY);
  if (text === "too_large") return TOO_LARGE;
  const parsed = parseJsonText(text);
  return parsed === undefined ? null : parsed;
}
