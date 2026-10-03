import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { parseDirectMessages } from "@/lib/messages/parse";

// Only Meta CDNs are downloaded (never an arbitrary URL from a payload).
const META_HOSTS = ["fbcdn.net", "fbsbx.com", "cdninstagram.com", "instagram.com", "facebook.com"];
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;

export function isMetaUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return META_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/**
 * Save every DM in a webhook payload. Returns the ids of media rows that still
 * need downloading (the worker fetches them right away, before the link expires).
 */
export async function storeDirectMessages(payload: unknown): Promise<string[]> {
  const parsed = parseDirectMessages(payload);
  const pending: string[] = [];

  for (const m of parsed) {
    const account = await prisma.instagramAccount.findUnique({
      where: { instagramId: m.accountId },
      select: { workspaceId: true },
    });
    const msg = await prisma.directMessage.upsert({
      where: { mid: m.mid },
      create: {
        workspaceId: account?.workspaceId ?? null,
        accountId: m.accountId,
        contactId: m.contactId,
        mid: m.mid,
        fromMe: m.fromMe,
        text: m.text,
        template: m.template ? (m.template as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        storyReply: m.storyReply,
        deleted: m.deleted,
        sentAt: m.sentAt,
      },
      update: m.deleted ? { deleted: true } : {},
      select: { id: true },
    });

    for (const [position, media] of m.media.entries()) {
      const status = media.download && isMetaUrl(media.url) ? "pending" : "link";
      const row = await prisma.directMedia.upsert({
        where: { messageId_position: { messageId: msg.id, position } },
        create: { messageId: msg.id, position, type: media.type, originalUrl: media.url, status },
        update: {},
        select: { id: true, status: true },
      });
      if (row.status === "pending") pending.push(row.id);
    }
  }
  return pending;
}

/** Download one media row from Meta and keep the bytes. */
export async function downloadDirectMedia(mediaId: string): Promise<string> {
  const media = await prisma.directMedia.findUnique({ where: { id: mediaId } });
  if (!media || media.status !== "pending") return media?.status ?? "missing";
  if (!isMetaUrl(media.originalUrl)) {
    await prisma.directMedia.update({ where: { id: mediaId }, data: { status: "link" } });
    return "link";
  }

  const res = await fetch(media.originalUrl, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
  if (res.status === 403 || res.status === 404 || res.status === 410) {
    await prisma.directMedia.update({ where: { id: mediaId }, data: { status: "expired" } });
    return "expired";
  }
  if (!res.ok) throw new Error(`media download ${res.status}`);

  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_MEDIA_BYTES) {
    await prisma.directMedia.update({ where: { id: mediaId }, data: { status: "too_big", size: declared } });
    return "too_big";
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_MEDIA_BYTES) {
    await prisma.directMedia.update({ where: { id: mediaId }, data: { status: "too_big", size: buf.length } });
    return "too_big";
  }
  await prisma.directMedia.update({
    where: { id: mediaId },
    data: {
      status: "saved",
      data: buf,
      size: buf.length,
      mime: res.headers.get("content-type")?.split(";")[0] ?? null,
      savedAt: new Date(),
    },
  });
  return "saved";
}
