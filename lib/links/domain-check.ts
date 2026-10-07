/**
 * Before a workspace saves its link domain (07/10/2026): does the domain
 * already reach THIS Lead Engine? Links on a domain that does not point here
 * yet (DNS, Cloudflare, Dokploy) would all break, so saving asks
 * https://<domain>/r/_ping and expects our answer.
 *
 * Server-only. The DNS is checked first (public IPs only, like the keys of
 * Canais), and redirects are not followed.
 */
import { assertResolvesPublic, type LookupAll } from "@/lib/integrations/url-guard";
import { LINK_PING_BODY, LINK_PING_SLUG } from "@/lib/links/hosts";

export type DomainCheckDeps = { fetch?: typeof fetch; lookup?: LookupAll };

export async function domainReachesUs(domain: string, deps: DomainCheckDeps = {}): Promise<boolean> {
  if (await assertResolvesPublic(domain, deps.lookup)) return false;
  const doFetch = deps.fetch ?? fetch;
  try {
    const res = await doFetch(`https://${domain}/r/${LINK_PING_SLUG}`, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (res.status !== 200) return false;
    return (await res.text()).trim() === LINK_PING_BODY;
  } catch {
    return false;
  }
}
