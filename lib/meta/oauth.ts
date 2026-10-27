import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "crypto";
import { getEncryptionKeyHex, requireEnv } from "@/lib/env";
import { INSTAGRAM_BASE_SCOPES, INSTAGRAM_PUBLISH_SCOPE } from "@/lib/meta/scopes";

// Instagram API with Instagram Login authorizes on www.instagram.com. The old
// api.instagram.com/oauth/authorize host belonged to the retired Basic Display
// API and now 404s ("Sorry, this page isn't available"), which looks like a bad
// link rather than a wrong endpoint. The token exchange below still lives on
// api.instagram.com — only the authorize hop moved.
const INSTAGRAM_OAUTH_URL = "https://www.instagram.com/oauth/authorize";
const INSTAGRAM_TOKEN_URL = "https://api.instagram.com/oauth/access_token";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const STATE_MAX_AGE_MS = 10 * 60 * 1000;

interface OAuthStatePayload {
  workspaceId: string;
  ts: number;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signState(payload: string): string {
  return createHmac("sha256", requireEnv("NEXTAUTH_SECRET"))
    .update(payload)
    .digest("base64url");
}

export function createOAuthState(workspaceId: string): string {
  const payload = base64UrlEncode(
    JSON.stringify({ workspaceId, ts: Date.now() } satisfies OAuthStatePayload)
  );
  return `${payload}.${signState(payload)}`;
}

export function verifyOAuthState(state: string | null): OAuthStatePayload | null {
  if (!state) return null;

  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;

  const expected = signState(payload);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(payload)) as OAuthStatePayload;
    if (!parsed.workspaceId || Date.now() - parsed.ts > STATE_MAX_AGE_MS) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

export { INSTAGRAM_BASE_SCOPES, INSTAGRAM_PUBLISH_SCOPE };

/*
 * Permissões da conta pelo Instagram Login. Nomes conferidos na documentação da Meta
 * (developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login,
 * .../content-publishing e /docs/permissions): basic, content_publish, manage_comments e
 * manage_messages. `manage_insights` já era pedida aqui antes e continua (as páginas consultadas
 * em 27/10/2026 não a listam, então é a única que não foi reconfirmada).
 */

/**
 * Publicar (Reels e carrossel, aba Posts) fica LIGADO por padrão. Interruptor de emergência:
 * INSTAGRAM_PUBLISH_DISABLED=1 volta ao pedido antigo (sem publicar). INSTAGRAM_PUBLISH_ENABLED=0
 * (nome antigo, que ligava) também desliga; qualquer outro valor dele é ignorado.
 */
export function isInstagramPublishRequested(env: Record<string, string | undefined> = process.env): boolean {
  if (env.INSTAGRAM_PUBLISH_DISABLED === "1") return false;
  if (env.INSTAGRAM_PUBLISH_ENABLED === "0") return false;
  return true;
}

/** Lista de permissões que o login do Instagram pede agora. */
export function getRequestedInstagramScopes(env: Record<string, string | undefined> = process.env): string[] {
  return isInstagramPublishRequested(env) ? [...INSTAGRAM_BASE_SCOPES, INSTAGRAM_PUBLISH_SCOPE] : [...INSTAGRAM_BASE_SCOPES];
}

export function getAuthorizationUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("INSTAGRAM_APP_ID"),
    redirect_uri: redirectUri,
    scope: getRequestedInstagramScopes().join(","),
    response_type: "code",
    state,
  });

  return `${INSTAGRAM_OAUTH_URL}?${params.toString()}`;
}

/**
 * A Meta devolve as permissões concedidas junto do token curto (campo `permissions`, texto
 * separado por vírgula; a documentação mostra o corpo dentro de `data[0]`, o código antigo lia
 * o corpo solto: os dois formatos são aceitos).
 */
export function parseGrantedScopes(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,\s]+/) : [];
  return Array.from(new Set(list.map((x) => String(x).trim()).filter((x) => /^[a-z_]{3,80}$/.test(x))));
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string
): Promise<{ accessToken: string; userId: string; permissions: string[] }> {
  const body = new URLSearchParams({
    client_id: requireEnv("INSTAGRAM_APP_ID"),
    client_secret: requireEnv("INSTAGRAM_APP_SECRET"),
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });

  const response = await fetch(INSTAGRAM_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(
      `Token exchange failed: ${error.error_message || JSON.stringify(error)}`
    );
  }

  const raw = await response.json();
  const data = Array.isArray(raw?.data) ? raw.data[0] ?? {} : raw;
  return {
    accessToken: data.access_token,
    userId: String(data.user_id),
    permissions: parseGrantedScopes(data.permissions),
  };
}

function getEncryptionKey(): Buffer {
  return Buffer.from(getEncryptionKeyHex(), "hex");
}

export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, authTag, encrypted]);

  return combined.toString("base64");
}

export function decryptToken(encryptedBase64: string): string {
  const key = getEncryptionKey();
  const combined = Buffer.from(encryptedBase64, "base64");

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8"
  );
}
