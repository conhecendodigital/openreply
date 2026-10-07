/**
 * The tracked URLs that go inside a DM (07/10/2026), for the worker:
 *
 *   https://<link domain or NEXTAUTH_URL>/r/<slug>/<code>
 *
 * <code> is this person's short code (lib/links/codes.ts). Without a person
 * (public reply) it is just /r/<slug>. If the code cannot be saved (database
 * busy), the link falls back to the old signed /r/<slug>?c=<igsid>.<sig>,
 * which the route still reads: the DM never goes without its link.
 *
 * Server-only. Never throws.
 */
import { buildTrackedUrl } from "@/lib/tracking/message";
import { recipientQuery } from "@/lib/tracking/recipient";
import { getWorkspaceLinkDomain, linkBaseUrl } from "@/lib/links/domain";
import { ensureRecipientCode } from "@/lib/links/codes";

export type LinkUrlInput = {
  workspaceId?: string | null;
  slugs: string[];
  recipientId?: string | null;
  dmLogId?: string | null;
};

/** slug -> URL to put in the text or the button. */
export async function recipientLinkUrls(input: LinkUrlInput): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (input.slugs.length === 0) return urls;
  const domain = await getWorkspaceLinkDomain(input.workspaceId).catch(() => null);
  const base = linkBaseUrl(domain);
  for (const slug of input.slugs) {
    if (!input.recipientId) {
      urls.set(slug, buildTrackedUrl(slug, base));
      continue;
    }
    try {
      if (!input.workspaceId) throw new Error("no workspace");
      const code = await ensureRecipientCode({
        workspaceId: input.workspaceId,
        slug,
        igUserId: input.recipientId,
        dmLogId: input.dmLogId ?? null,
      });
      urls.set(slug, `${base}/r/${encodeURIComponent(slug)}/${code}`);
    } catch {
      urls.set(slug, buildTrackedUrl(slug, base, recipientQuery(slug, input.recipientId)));
    }
  }
  return urls;
}

/** Same, as a lookup the worker's builders take: (link) -> URL. */
export async function linkUrlResolver(input: LinkUrlInput): Promise<(link: { slug: string }) => string> {
  const urls = await recipientLinkUrls(input);
  const fallbackBase = linkBaseUrl(null);
  return (link) => urls.get(link.slug) ?? buildTrackedUrl(link.slug, fallbackBase, recipientQuery(link.slug, input.recipientId));
}
