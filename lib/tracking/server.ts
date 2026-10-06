import { createHash, randomBytes } from "node:crypto";

export function generateTrackedLinkSlug() {
  return randomBytes(7).toString("base64url");
}

export function hashClickIp(ipAddress: string | null | undefined) {
  if (!ipAddress) return null;

  const salt = process.env.NEXTAUTH_SECRET ?? "campaigncue-click-salt";
  return createHash("sha256").update(`${salt}:${ipAddress}`).digest("hex");
}

/**
 * Client IP behind ONE trusted proxy (Dokploy's Traefik). The proxy appends
 * the address it saw at the END of X-Forwarded-For, so the last entry is the
 * one nobody outside can choose. The first entry is whatever the client sent
 * (auditoria 05/10: taking it let anyone dodge the per-IP limits of the quiz
 * and send a made-up IP to the Conversions API).
 */
export function getRequestIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const parts = forwardedFor.split(",").map((p) => p.trim()).filter(Boolean);
    return parts[parts.length - 1] ?? null;
  }

  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    null
  );
}
