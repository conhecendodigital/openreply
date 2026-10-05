/**
 * Etapa 6 (Quiz): fetch helper of the panel screens and the sentence shown
 * for each error code the funnel API sends back (spec section 6). Same shape
 * as flowApi / flowErrorText, so the screens read the same way.
 */

import type { TFunction } from "@/lib/i18n";

export type ApiResult<T> =
  | { success: true; data: T }
  | { success: false; error?: string; details?: { code?: string } & Record<string, unknown> };

export async function funnelApi<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<ApiResult<T>> {
  try {
    const { json, ...rest } = init ?? {};
    const res = await fetch(url, {
      cache: "no-store",
      ...rest,
      ...(json !== undefined
        ? { body: JSON.stringify(json), headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) } }
        : {}),
    });
    const payload = (await res.json().catch(() => null)) as ApiResult<T> | null;
    return payload ?? { success: false, error: `HTTP ${res.status}` };
  } catch {
    return { success: false, error: "network" };
  }
}

/** Every `details.code` the funnel API can send (spec section 6). */
export const FUNNEL_ERROR_CODES = [
  "human_only",
  "draft_only",
  "slug_taken",
  "invalid_slug",
  "invalid_funnel",
  "invalid_template",
  "published",
  "fix_before_publish",
  "consent_required",
  "rate_limited",
  "too_large",
  "not_configured",
] as const;
export type FunnelErrorCode = (typeof FUNNEL_ERROR_CODES)[number];

/** English key (translated by t) for each code. Kept as data so a test can check them all. */
export const FUNNEL_ERROR_TEXT: Record<FunnelErrorCode, string> = {
  human_only: "Only a signed-in person can do this, in the Lead Engine.",
  draft_only: "Publish and unpublish with their own buttons. Saving only changes the draft.",
  slug_taken: "This link is already used by another quiz. Pick another one.",
  invalid_slug: "The link can only have lowercase letters, numbers and hyphens (3 to 60).",
  invalid_funnel: "Something in the quiz is not in the right format. Check the fields marked in red.",
  invalid_template: "This template does not exist.",
  published: "Unpublish the quiz before deleting it.",
  fix_before_publish: "Fix what is listed before publishing.",
  consent_required: "Tick the consent box to continue.",
  rate_limited: "Too many tries in a row. Wait a moment and try again.",
  too_large: "The quiz is too big to save. Remove some screens or blocks.",
  not_configured: "This is not configured on the server yet.",
};

/** Server error code -> sentence for the owner. */
export function funnelErrorText(t: TFunction, result: ApiResult<unknown>): string {
  if (result.success) return "";
  const code = result.details?.code;
  if (code && code in FUNNEL_ERROR_TEXT) return t(FUNNEL_ERROR_TEXT[code as FunnelErrorCode]);
  if (result.error === "network") return t("No connection. Try again.");
  if (result.error === "Not found" || result.error === "Funnel not found") return t("Quiz not found.");
  return t("Something went wrong: {error}", { error: result.error ?? "?" });
}
