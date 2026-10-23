/**
 * 23/10/2026: Login Kit do TikTok (OAuth 2.0). Implementação própria a partir
 * da documentação pública do TikTok for Developers. Nenhum código de terceiros.
 */
import { requireEnv } from "@/lib/env";

const AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/";
const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const USER_INFO_URL = "https://open.tiktokapis.com/v2/user/info/";

export const TIKTOK_SCOPES = ["user.info.basic", "video.upload", "video.publish"] as const;

export function getMissingTikTokEnv(env: Record<string, string | undefined> = process.env): string[] {
  return ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"].filter((name) => !env[name]?.trim());
}

export function getTikTokAuthorizationUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_key: requireEnv("TIKTOK_CLIENT_KEY"),
    scope: TIKTOK_SCOPES.join(","),
    response_type: "code",
    redirect_uri: redirectUri,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export interface TikTokTokens {
  accessToken: string;
  refreshToken: string | null;
  openId: string;
  scopes: string[];
  /** Segundos até o access token vencer (24 h no TikTok). */
  expiresIn: number;
  /** Segundos até o refresh token vencer (365 dias no TikTok). */
  refreshExpiresIn: number | null;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  open_id?: string;
  scope?: string;
  expires_in?: number;
  refresh_expires_in?: number;
  error?: string;
  error_description?: string;
}

async function postToken(body: URLSearchParams): Promise<TikTokTokens> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Cache-Control": "no-cache" },
    body: body.toString(),
  });
  const data = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok || !data.access_token || !data.open_id) {
    throw new TikTokAuthError(data.error_description || data.error || `TikTok token error (${response.status})`, data.error);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    openId: data.open_id,
    scopes: (data.scope ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    expiresIn: data.expires_in ?? 86400,
    refreshExpiresIn: data.refresh_expires_in ?? null,
  };
}

/** `invalid_grant` e parecidos: o refresh token não serve mais, a pessoa precisa conectar de novo. */
export class TikTokAuthError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "TikTokAuthError";
  }
  get needsReconnect(): boolean {
    return this.code === "invalid_grant" || this.code === "invalid_request";
  }
}

export function exchangeTikTokCode(code: string, redirectUri: string): Promise<TikTokTokens> {
  return postToken(
    new URLSearchParams({
      client_key: requireEnv("TIKTOK_CLIENT_KEY"),
      client_secret: requireEnv("TIKTOK_CLIENT_SECRET"),
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    })
  );
}

export function refreshTikTokToken(refreshToken: string): Promise<TikTokTokens> {
  return postToken(
    new URLSearchParams({
      client_key: requireEnv("TIKTOK_CLIENT_KEY"),
      client_secret: requireEnv("TIKTOK_CLIENT_SECRET"),
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    })
  );
}

export interface TikTokProfile {
  openId: string;
  displayName: string;
  avatarUrl: string | null;
  username: string | null;
}

export async function getTikTokProfile(accessToken: string): Promise<TikTokProfile> {
  const response = await fetch(`${USER_INFO_URL}?fields=open_id,avatar_url,display_name`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await response.json().catch(() => ({}))) as {
    data?: { user?: { open_id?: string; avatar_url?: string; display_name?: string } };
    error?: { code?: string; message?: string };
  };
  const user = body.data?.user;
  if (!response.ok || !user?.open_id) {
    throw new Error(body.error?.message || `TikTok user info error (${response.status})`);
  }
  return {
    openId: user.open_id,
    displayName: user.display_name?.trim() || "TikTok",
    avatarUrl: user.avatar_url ?? null,
    username: null,
  };
}
