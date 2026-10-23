/**
 * 23/10/2026: OAuth 2.0 do Google para o YouTube. Implementação própria a
 * partir da documentação pública do Google. Usa o mesmo app Google do login
 * do Lead Engine (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET) quando
 * YOUTUBE_CLIENT_ID/YOUTUBE_CLIENT_SECRET não existem.
 */
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/youtube/v3";

export const YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";

/**
 * Tudo que o Lead Engine vai usar do YouTube, pedido de uma vez na conexão:
 * publicar (upload), ler o canal (readonly), comentários (force-ssl, para o
 * próximo PR) e gerenciar a conta (youtube). Pode ser trocado por
 * YOUTUBE_OAUTH_SCOPES (separado por vírgula ou espaço), como o Facebook faz.
 */
export const YOUTUBE_SCOPES = [
  YOUTUBE_UPLOAD_SCOPE,
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/youtube",
] as const;

export function youtubeScopes(env: Record<string, string | undefined> = process.env): string[] {
  const custom = env.YOUTUBE_OAUTH_SCOPES?.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  return custom && custom.length > 0 ? custom : [...YOUTUBE_SCOPES];
}

/** Escopos que a pessoa não concedeu na tela do Google (ela pode desmarcar). Vazio = tudo certo. */
export function missingYouTubeScopes(granted: readonly string[], wanted: readonly string[] = youtubeScopes()): string[] {
  return wanted.filter((scope) => !granted.includes(scope));
}

export function youtubeCredentials(env: Record<string, string | undefined> = process.env): { clientId: string; clientSecret: string } | null {
  const clientId = (env.YOUTUBE_CLIENT_ID || env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = (env.YOUTUBE_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET || "").trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function getMissingYouTubeEnv(env: Record<string, string | undefined> = process.env): string[] {
  return youtubeCredentials(env) ? [] : ["YOUTUBE_CLIENT_ID (or GOOGLE_CLIENT_ID)", "YOUTUBE_CLIENT_SECRET (or GOOGLE_CLIENT_SECRET)"];
}

function creds() {
  const c = youtubeCredentials();
  if (!c) throw new YouTubeAuthError("YouTube is not configured on this server", "misconfigured");
  return c;
}

export function getYouTubeAuthorizationUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: creds().clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: youtubeScopes().join(" "),
    access_type: "offline",
    // Sem consent o Google só entrega refresh token na primeira vez.
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

export class YouTubeAuthError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = "YouTubeAuthError";
  }
  get needsReconnect(): boolean {
    return this.code === "invalid_grant";
  }
}

export interface YouTubeTokens {
  accessToken: string;
  refreshToken: string | null;
  scopes: string[];
  /** Segundos até o access token vencer (1 h no Google). */
  expiresIn: number;
}

async function postToken(body: URLSearchParams): Promise<YouTubeTokens> {
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    scope?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!response.ok || !data.access_token) {
    throw new YouTubeAuthError(data.error_description || data.error || `Google token error (${response.status})`, data.error);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    scopes: (data.scope ?? "").split(/\s+/).filter(Boolean),
    expiresIn: data.expires_in ?? 3600,
  };
}

export function exchangeYouTubeCode(code: string, redirectUri: string): Promise<YouTubeTokens> {
  const { clientId, clientSecret } = creds();
  return postToken(
    new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, grant_type: "authorization_code", redirect_uri: redirectUri })
  );
}

export function refreshYouTubeToken(refreshToken: string): Promise<YouTubeTokens> {
  const { clientId, clientSecret } = creds();
  return postToken(
    new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: refreshToken })
  );
}

export interface YouTubeChannelProfile {
  channelId: string;
  title: string;
  handle: string | null;
  avatarUrl: string | null;
}

/** Erro de uma chamada ao YouTube, com o motivo que o Google informa (`reason`). */
export class YouTubeApiError extends Error {
  constructor(message: string, readonly status: number, readonly reason?: string) {
    super(message);
    this.name = "YouTubeApiError";
  }
  get isAuth(): boolean {
    return this.status === 401;
  }
  /** A YouTube Data API v3 não está ligada no projeto do Google Cloud. */
  get apiDisabled(): boolean {
    return this.reason === "accessNotConfigured" || this.reason === "SERVICE_DISABLED";
  }
}

export const API_DISABLED_MESSAGE =
  "The YouTube Data API v3 is not enabled in the Google Cloud project. Enable it there and try again.";

export function youtubeErrorFrom(status: number, body: unknown): YouTubeApiError {
  const error = (body as { error?: { message?: string; errors?: Array<{ reason?: string }>; status?: string; details?: Array<{ reason?: string }> } })?.error;
  const reason = error?.errors?.[0]?.reason ?? error?.details?.find((d) => d.reason)?.reason ?? error?.status;
  const raw = error?.message ?? `YouTube error (${status})`;
  const apiDisabled = reason === "accessNotConfigured" || reason === "SERVICE_DISABLED";
  let message = raw;
  if (apiDisabled) message = API_DISABLED_MESSAGE;
  else if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") message = "The YouTube daily quota of this Google project is over. Try again tomorrow.";
  else if (reason === "uploadLimitExceeded") message = "YouTube upload limit reached for this channel. Try again later.";
  else if (reason === "insufficientPermissions" || reason === "forbidden") message = "YouTube did not allow this. Connect the channel again and accept every permission.";
  return new YouTubeApiError(message.slice(0, 500), status, apiDisabled ? "accessNotConfigured" : reason);
}

export async function getYouTubeChannel(accessToken: string): Promise<YouTubeChannelProfile> {
  const response = await fetch(`${API}/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = (await response.json().catch(() => ({}))) as {
    items?: Array<{ id?: string; snippet?: { title?: string; customUrl?: string; thumbnails?: { default?: { url?: string } } } }>;
  };
  if (!response.ok) throw youtubeErrorFrom(response.status, body);
  const item = body.items?.[0];
  if (!item?.id) throw new YouTubeApiError("This Google account has no YouTube channel", 404, "no_channel");
  return {
    channelId: item.id,
    title: item.snippet?.title?.trim() || "YouTube",
    handle: item.snippet?.customUrl ?? null,
    avatarUrl: item.snippet?.thumbnails?.default?.url ?? null,
  };
}
