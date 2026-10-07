/**
 * Hosts that reach this app (07/10/2026). Pure, no imports: proxy.ts and the
 * /r route both use it.
 *
 * - app host: the host of NEXTAUTH_URL (many.leadenginer.com), local
 *   development hosts and internal service names without a dot (the cron calls
 *   the web as openreply-web-qsbqgu:3000). Without NEXTAUTH_URL every host
 *   counts as the app (we cannot tell).
 * - quiz domains: QUIZ_DOMAINS (comma separated) or, when it is empty, any
 *   other host (see isQuizHost in proxy.ts).
 * - link domain: the host a workspace saved in Canais (Workspace.linkDomain).
 *   Only /r/* opens there.
 */

type Env = Record<string, string | undefined>;

/** "Host: A.com:443, b" -> "a.com". */
export function hostOf(value: string | null | undefined): string {
  return (value ?? "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

/** Host of NEXTAUTH_URL, or "" when it is missing or broken. */
export function appHostname(env: Env = process.env): string {
  try {
    return env.NEXTAUTH_URL ? new URL(env.NEXTAUTH_URL).hostname.toLowerCase() : "";
  } catch {
    return "";
  }
}

export function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1" || host.endsWith(".localhost");
}

/** true = the app itself (panel, API, webhooks), never a domain of a customer. */
export function isAppHost(host: string, env: Env = process.env): boolean {
  if (!host) return true;
  const app = appHostname(env);
  if (!app) return true; // without the app host we cannot tell: behave as the app
  if (host === app) return true;
  if (isLocalHost(host)) return true;
  // Internal service names (Docker/Dokploy) have no dot.
  return !host.includes(".");
}

/** QUIZ_DOMAINS, normalized. Empty = not listed (any other host is a quiz domain). */
export function listedQuizDomains(env: Env = process.env): string[] {
  return (env.QUIZ_DOMAINS ?? "")
    .split(",")
    .map((h) => hostOf(h))
    .filter(Boolean);
}

/** Host of the request: Host header first, then X-Forwarded-Host, then the URL. */
export function requestHost(request: Request): string {
  return hostOf(request.headers.get("host") ?? request.headers.get("x-forwarded-host") ?? new URL(request.url).host);
}
