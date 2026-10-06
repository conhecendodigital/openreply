/**
 * Endereço que o dono do workspace cola em Canais > Conexões e chaves (Server
 * URL da uazapi, URL do gateway OpenWA). O servidor do Lead Engine chama esse
 * endereço com a chave junto, então ele precisa ser público e https:
 * nada de localhost, rede interna, IP do provedor de nuvem (169.254.169.254)
 * ou nome de serviço do Docker. Sem isso, um admin de workspace poderia fazer
 * o servidor bater em coisa interna (SSRF).
 *
 * Duas camadas:
 *   checkPublicHttpsUrl: só olhando o texto (rápido, roda também na leitura);
 *   assertResolvesPublic: resolve o DNS e confere cada IP (ao salvar e ao testar).
 *
 * O que vem das variáveis de ambiente (Dokploy) NÃO passa por aqui: é o
 * operador do servidor quem põe, e pode ser um endereço interno de propósito.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export type UrlProblem = "url_invalid" | "url_not_https" | "url_internal";

export type UrlCheck = { ok: true; url: string; hostname: string } | { ok: false; code: UrlProblem };

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa", ".intranet", ".corp", ".private"];

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const V4_BLOCKED: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function isPrivateV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4ToInt(base) & mask);
  });
}

function isPrivateV6(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v === "::" || v === "::1") return true;
  // IPv4 dentro do IPv6 (::ffff:10.0.0.1).
  const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);
  if (/^::ffff:/.test(v)) return true;
  const first = Number.parseInt(v.split(":")[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 (rede local)
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 (link local)
  if ((first & 0xff00) === 0xff00) return true; // multicast
  if (v.startsWith("64:ff9b:") || v.startsWith("2001:db8:")) return true;
  return false;
}

/** true = IP de rede interna, loopback, link local, reservado ou multicast. */
export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip.replace(/^\[|\]$/g, ""));
  if (kind === 4) return isPrivateV4(ip);
  if (kind === 6) return isPrivateV6(ip);
  return true;
}

/**
 * Confere só o texto: https, sem usuário e senha na URL, host público (nome
 * com ponto, sem sufixo interno, IP literal só se for público). Devolve a URL
 * limpa (sem barra no fim, sem ?query e #).
 */
export function checkPublicHttpsUrl(raw: unknown): UrlCheck {
  if (typeof raw !== "string") return { ok: false, code: "url_invalid" };
  const text = raw.trim();
  if (!text || text.length > 300) return { ok: false, code: "url_invalid" };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, code: "url_invalid" };
  }
  if (url.protocol !== "https:") return { ok: false, code: "url_not_https" };
  if (url.username || url.password) return { ok: false, code: "url_invalid" };
  if (url.port && url.port !== "443" && Number(url.port) < 1024) return { ok: false, code: "url_internal" };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, code: "url_invalid" };
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIP(bare)) {
    if (isPrivateIp(bare)) return { ok: false, code: "url_internal" };
  } else {
    if (host === "localhost" || !host.includes(".")) return { ok: false, code: "url_internal" };
    if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return { ok: false, code: "url_internal" };
    if (!/^[a-z0-9.-]+$/.test(host)) return { ok: false, code: "url_invalid" };
  }
  const path = url.pathname.replace(/\/+$/, "");
  return { ok: true, url: `${url.protocol}//${url.host}${path}`, hostname: bare };
}

export type LookupAll = (hostname: string) => Promise<Array<{ address: string }>>;

const defaultLookup: LookupAll = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

/**
 * Resolve o nome e recusa se QUALQUER IP for interno. Nome que não resolve
 * também é recusado (não dá pra saber pra onde ia).
 */
export async function assertResolvesPublic(hostname: string, lookup: LookupAll = defaultLookup): Promise<UrlProblem | null> {
  if (isIP(hostname)) return isPrivateIp(hostname) ? "url_internal" : null;
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname);
  } catch {
    return "url_invalid";
  }
  if (addresses.length === 0) return "url_invalid";
  return addresses.some((a) => isPrivateIp(a.address)) ? "url_internal" : null;
}

/** As duas camadas juntas. */
export async function checkPublicUrlWithDns(raw: unknown, lookup?: LookupAll): Promise<UrlCheck> {
  const check = checkPublicHttpsUrl(raw);
  if (!check.ok) return check;
  const problem = await assertResolvesPublic(check.hostname, lookup);
  return problem ? { ok: false, code: problem } : check;
}
