import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { buildClickUrl, buildIgMeUrl, defaultTagFor } from "@/lib/conversation-links/links";

export const LINK_INCLUDE = {
  instagramAccount: { select: { id: true, username: true } },
  automation: { select: { id: true, name: true, isActive: true } },
} as const;

type LinkRow = {
  id: string;
  code: string;
  origin: string;
  tagName: string | null;
  automationId: string | null;
  clicks: number;
  opens: number;
  isActive: boolean;
  createdAt: Date;
  instagramAccount: { id: string; username: string };
  automation: { id: string; name: string; isActive: boolean } | null;
};

/** Links with their ig.me + /c/ URLs and how many different people opened each. */
export async function presentLinks(rows: LinkRow[]) {
  const ids = rows.map((r) => r.id);
  const pairs =
    ids.length > 0
      ? await prisma.conversationLinkOpen.groupBy({ by: ["linkId", "contactId"], where: { linkId: { in: ids } } })
      : [];
  const people = new Map<string, number>();
  for (const p of pairs) people.set(p.linkId, (people.get(p.linkId) ?? 0) + 1);
  const base = getBaseUrl();

  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    origin: r.origin,
    tag: r.tagName || defaultTagFor(r.origin),
    automation: r.automation,
    isActive: r.isActive,
    createdAt: r.createdAt,
    account: r.instagramAccount,
    igMeUrl: buildIgMeUrl(r.instagramAccount.username, r.code),
    clickUrl: buildClickUrl(base, r.code),
    clicks: r.clicks,
    opens: r.opens,
    contacts: people.get(r.id) ?? 0,
  }));
}
