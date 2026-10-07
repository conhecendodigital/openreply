/**
 * Domain of the tracked links of a workspace (07/10/2026), e.g.
 * comando.cloudmatheus.com.br. Saved in Canais > Conexões e chaves, stored in
 * Workspace.linkDomain (only the host). The worker builds the DM links on it
 * and the app answers only /r/* there (proxy.ts). Without one the links stay
 * on NEXTAUTH_URL, exactly as before.
 *
 * Server-only. Both lookups are cached for 60 s per process; saving clears the
 * cache of the web process right away (the worker sees it within 60 s).
 */
import { isIP } from "node:net";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { appHostname, isLocalHost, listedQuizDomains } from "@/lib/links/hosts";

type Env = Record<string, string | undefined>;

export type LinkDomainProblem = "domain_invalid" | "domain_app" | "domain_internal";
export type LinkDomainCheck = { ok: true; domain: string } | { ok: false; code: LinkDomainProblem };

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".intranet", ".corp", ".private", ".invalid", ".test", ".example"];
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOSTNAME_RE = new RegExp(`^(?:${LABEL}\\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$`);

/**
 * What the owner typed -> the host. Accepts "comando.site.com",
 * "https://comando.site.com/" or with a path (dropped). Refuses the app's own
 * host, IPs, ports, local and internal names.
 */
export function normalizeLinkDomain(raw: unknown, env: Env = process.env): LinkDomainCheck {
  if (typeof raw !== "string") return { ok: false, code: "domain_invalid" };
  let text = raw.trim().toLowerCase();
  if (!text || text.length > 300) return { ok: false, code: "domain_invalid" };
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(text)) text = `https://${text}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, code: "domain_invalid" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { ok: false, code: "domain_invalid" };
  if (url.username || url.password || (url.port && url.port !== "443")) return { ok: false, code: "domain_invalid" };
  const host = url.hostname.replace(/\.$/, "");
  if (!host || isIP(host.replace(/^\[|\]$/g, ""))) return { ok: false, code: "domain_invalid" };
  if (isLocalHost(host) || !host.includes(".") || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, code: "domain_internal" };
  }
  if (host.length > 253 || !HOSTNAME_RE.test(host)) return { ok: false, code: "domain_invalid" };
  if (host === appHostname(env)) return { ok: false, code: "domain_app" };
  return { ok: true, domain: host };
}

/** https://<domain>, or the app's own base (NEXTAUTH_URL) when there is none. */
export function linkBaseUrl(domain: string | null | undefined): string {
  return domain ? `https://${domain}` : getBaseUrl().replace(/\/+$/, "");
}

/** true = the link domain is also listed as a quiz domain (it then shows quizzes too). */
export function isAlsoQuizDomain(host: string, env: Env = process.env): boolean {
  return listedQuizDomains(env).includes(host);
}

const TTL_MS = 60_000;
const MAX_ENTRIES = 1000;
type Entry = { value: string | null; at: number };
const byWorkspace = new Map<string, Entry>();
const byHost = new Map<string, Entry>();

function cached(map: Map<string, Entry>, key: string): Entry | undefined {
  const hit = map.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  return undefined;
}

function remember(map: Map<string, Entry>, key: string, value: string | null) {
  if (map.size >= MAX_ENTRIES) map.clear();
  map.set(key, { value, at: Date.now() });
}

export function invalidateLinkDomainCache(): void {
  byWorkspace.clear();
  byHost.clear();
}

/** The workspace's link domain, or null. Never throws (null on error). */
export async function getWorkspaceLinkDomain(workspaceId: string | null | undefined): Promise<string | null> {
  if (!workspaceId) return null;
  const hit = cached(byWorkspace, workspaceId);
  if (hit) return hit.value;
  try {
    const row = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { linkDomain: true } });
    const value = row?.linkDomain ?? null;
    remember(byWorkspace, workspaceId, value);
    return value;
  } catch {
    return null;
  }
}

/** Id of the workspace whose link domain is `host`, or null. Never throws. */
export async function workspaceForLinkHost(host: string): Promise<string | null> {
  if (!host || !host.includes(".")) return null;
  const hit = cached(byHost, host);
  if (hit) return hit.value;
  try {
    const row = await prisma.workspace.findUnique({ where: { linkDomain: host }, select: { id: true } });
    const value = row?.id ?? null;
    remember(byHost, host, value);
    return value;
  } catch {
    return null;
  }
}
