/**
 * 23/10/2026: chamadas de publicação da Meta (Instagram Reels e vídeo de Page
 * do Facebook). Token do Instagram Login vai em graph.instagram.com; token de
 * Page (EAA...) em graph.facebook.com, igual ao resto do app (lib/meta/client.ts).
 */
import { getMetaGraphApiVersion } from "@/lib/env";
import { MetaApiError, PermissionError, RateLimitError, TokenExpiredError } from "@/lib/meta/client";
import { isFacebookPageToken } from "@/lib/meta/platform";

function base(accessToken: string): string {
  const host = isFacebookPageToken(accessToken) ? "graph.facebook.com" : "graph.instagram.com";
  return `https://${host}/${getMetaGraphApiVersion()}`;
}

interface GraphError {
  error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string; type?: string };
}

export async function graphCall<T>(
  accessToken: string,
  method: "GET" | "POST",
  path: string,
  params: Record<string, string | boolean | undefined> = {}
): Promise<T> {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) form.set(key, String(value));
  }
  form.set("access_token", accessToken);
  const url = `${base(accessToken)}${path}`;
  const response =
    method === "GET"
      ? await fetch(`${url}?${form.toString()}`)
      : await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form.toString() });
  const data = (await response.json().catch(() => ({}))) as T & GraphError;
  if (!response.ok || data.error) {
    const err = data.error;
    const code = err?.code ?? response.status;
    const message = `${err?.message ?? "Unknown Meta API error"} [code=${code} sub=${err?.error_subcode ?? "-"} trace=${err?.fbtrace_id ?? "-"}]`;
    if (code === 190) throw new TokenExpiredError(message, err?.fbtrace_id);
    if (code === 4 || code === 17 || code === 368) throw new RateLimitError(message, err?.fbtrace_id);
    if (code === 10 || code === 200 || code === 100) throw new PermissionError(message, err?.fbtrace_id);
    throw new MetaApiError(code, err?.error_subcode, err?.fbtrace_id, message);
  }
  return data;
}

export type MetaPublishFailure = { message: string; needsReconnect: boolean };

/** Traduz o erro da Meta numa frase clara. `needsReconnect` marca a conta pra conectar de novo. */
export function explainMetaError(error: unknown, label: string): MetaPublishFailure {
  if (error instanceof TokenExpiredError) {
    return { message: `${label} refused the access. Connect the account again.`, needsReconnect: true };
  }
  if (error instanceof PermissionError) {
    return {
      message: `${label} did not allow publishing. Connect the account again in Channels and accept the publishing permission.`,
      needsReconnect: false,
    };
  }
  if (error instanceof RateLimitError) {
    return { message: `${label} limit reached. Try again later.`, needsReconnect: false };
  }
  return { message: (error instanceof Error ? error.message : String(error)).slice(0, 500), needsReconnect: false };
}
