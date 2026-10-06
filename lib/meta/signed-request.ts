import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * `signed_request` da Meta (exclusão de dados e desautorização, 06/10/2026).
 *
 * Formato: `<assinatura>.<payload>`, as duas partes em base64url. A assinatura
 * é o HMAC-SHA256 do payload (o texto em base64url, do jeito que chegou) com o
 * segredo do app. O payload é um JSON com `algorithm`, `issued_at` e `user_id`.
 *
 * Regras:
 *  - assinatura conferida em tempo constante (timingSafeEqual) ANTES de confiar
 *    em qualquer campo do payload;
 *  - só aceita algorithm = HMAC-SHA256;
 *  - user_id tem que vir como texto de dígitos (um número grande em JSON perde
 *    precisão, então número só vale se for inteiro seguro).
 */

export type SignedRequestPayload = {
  algorithm: "HMAC-SHA256";
  user_id: string;
  issued_at?: number;
  expires?: number;
  [key: string]: unknown;
};

export type SignedRequestFailure =
  | "missing"
  | "malformed"
  | "bad_signature"
  | "bad_algorithm"
  | "no_user"
  | "no_secret";

export type SignedRequestResult =
  | { ok: true; payload: SignedRequestPayload }
  | { ok: false; reason: SignedRequestFailure };

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const USER_ID = /^\d{1,32}$/;

function decodeBase64Url(value: string): Buffer | null {
  if (!value || !BASE64URL.test(value)) return null;
  const normalized = value.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

/** Assina um payload do mesmo jeito que a Meta (usado nos testes). */
export function signSignedRequest(payload: Record<string, unknown>, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${signature}.${body}`;
}

function signatureMatches(body: string, signature: Buffer, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(body).digest();
  return expected.length === signature.length && timingSafeEqual(expected, signature);
}

/**
 * Confere e abre um signed_request. `secrets` aceita mais de um segredo (o do
 * app do Instagram primeiro); basta um bater. Segredo vazio é ignorado.
 */
export function parseSignedRequest(
  signedRequest: string | null | undefined,
  secrets: Array<string | null | undefined>
): SignedRequestResult {
  const keys = secrets.filter((s): s is string => typeof s === "string" && s.length > 0);
  if (keys.length === 0) return { ok: false, reason: "no_secret" };
  if (typeof signedRequest !== "string" || !signedRequest.trim()) return { ok: false, reason: "missing" };

  const parts = signedRequest.trim().split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [encodedSignature, body] = parts;
  const signature = decodeBase64Url(encodedSignature);
  if (!signature || signature.length === 0 || !BASE64URL.test(body)) return { ok: false, reason: "malformed" };

  if (!keys.some((key) => signatureMatches(body, signature, key))) {
    return { ok: false, reason: "bad_signature" };
  }

  let data: unknown;
  try {
    data = JSON.parse(decodeBase64Url(body)!.toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false, reason: "malformed" };
  const record = data as Record<string, unknown>;

  if (typeof record.algorithm !== "string" || record.algorithm.toUpperCase() !== "HMAC-SHA256") {
    return { ok: false, reason: "bad_algorithm" };
  }

  const rawUser = record.user_id;
  let userId: string | null = null;
  if (typeof rawUser === "string" && USER_ID.test(rawUser.trim())) userId = rawUser.trim();
  else if (typeof rawUser === "number" && Number.isSafeInteger(rawUser) && rawUser > 0) userId = String(rawUser);
  if (!userId) return { ok: false, reason: "no_user" };

  return {
    ok: true,
    payload: {
      ...record,
      algorithm: "HMAC-SHA256",
      user_id: userId,
      issued_at: typeof record.issued_at === "number" ? record.issued_at : undefined,
      expires: typeof record.expires === "number" ? record.expires : undefined,
    },
  };
}

/** Segredos usados pra conferir: o do app do Instagram e, de reserva, o do app da Meta. */
export function signedRequestSecrets(env: Record<string, string | undefined> = process.env): string[] {
  return [env.INSTAGRAM_APP_SECRET, env.FACEBOOK_APP_SECRET].filter(
    (s): s is string => typeof s === "string" && s.trim().length > 0
  );
}

/** Lê o campo signed_request de um corpo form-urlencoded (ou JSON, por tolerância). */
export async function readSignedRequestField(request: Request): Promise<string | null> {
  const contentType = request.headers.get("content-type") ?? "";
  const raw = await request.text().catch(() => "");
  if (!raw) return null;
  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(raw) as { signed_request?: unknown };
      return typeof parsed.signed_request === "string" ? parsed.signed_request : null;
    } catch {
      return null;
    }
  }
  return new URLSearchParams(raw).get("signed_request");
}
