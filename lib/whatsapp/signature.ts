/**
 * Assinatura dos webhooks de WhatsApp. Sempre em tempo constante.
 *
 * OpenWA: X-OpenWA-Signature: sha256=<hex> = HMAC-SHA256(corpo cru, segredo do número).
 * Meta:   X-Hub-Signature-256: sha256=<hex> = HMAC-SHA256(corpo cru, segredo do app).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export function signBody(rawBody: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * Compara `sha256=<hex>` com o esperado. Os dois lados viram digest de
 * tamanho fixo antes do timingSafeEqual, então nem o tamanho vaza.
 */
export function verifyHmacSignature(rawBody: string, header: string | null | undefined, secret: string | null | undefined): boolean {
  if (!header || !secret) return false;
  const received = header.trim();
  if (!/^sha256=[0-9a-fA-F]{64}$/.test(received)) return false;
  const expected = signBody(rawBody, secret);
  const a = createHmac("sha256", "wa-cmp").update(received.toLowerCase()).digest();
  const b = createHmac("sha256", "wa-cmp").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Aceita se bater com qualquer um dos segredos (rotação de segredo do app). */
export function verifyAnySecret(rawBody: string, header: string | null | undefined, secrets: Array<string | null | undefined>): boolean {
  let ok = false;
  // Confere todos, sem parar no primeiro, pra não variar o tempo pela posição.
  for (const secret of secrets) {
    if (verifyHmacSignature(rawBody, header, secret)) ok = true;
  }
  return ok;
}
