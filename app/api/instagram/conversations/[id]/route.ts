import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { getConversationMessages, MetaApiError } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import {
  extractMessageMedia,
  extractWebhookMedia,
  type MessageMedia,
} from "@/lib/meta/message-media";
import { prisma } from "@/lib/db/client";

export interface ThreadTemplate {
  title: string;
  subtitle?: string;
  buttons: { title: string; url?: string }[];
}

export interface ThreadMessage {
  id: string;
  text: string;
  fromMe: boolean;
  fromUsername: string | null;
  createdTime: string | null;
  media?: MessageMedia[];
  /** Campaign DM with buttons, shown like the Instagram app shows it. */
  template?: ThreadTemplate | null;
  /** The person replied to (or mentioned us in) a story. */
  storyReply?: boolean;
  deleted?: boolean;
}

export interface ThreadResponse {
  messages: ThreadMessage[];
  /** How many came from our saved history (the API alone returns 20). */
  saved: number;
}

type RouteProps = { params: Promise<{ id: string }> };

const MEDIA_TYPE: Record<string, MessageMedia["type"]> = {
  image: "image", video: "video", audio: "audio", file: "file", share: "share", story: "story", reel: "video",
};

// Full conversation: the saved history (every DM the webhook ever delivered,
// with media kept in our database) merged with the latest 20 from the API.
export async function GET(request: NextRequest, { params }: RouteProps) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id: conversationId } = await params;

  const account = await getWorkspaceInstagramAccount(
    workspaceId,
    request.nextUrl.searchParams.get("instagramAccountId")
  );
  if (!account) {
    return NextResponse.json({ success: false, error: "Instagram account not connected." }, { status: 400 });
  }

  let contactId = request.nextUrl.searchParams.get("contactId") || "";
  let apiMessages: ThreadMessage[] = [];
  let apiError: string | null = null;

  try {
    const accessToken = decryptToken(account.accessToken);
    const raw = await getConversationMessages(accessToken, conversationId);
    apiMessages = raw.map((m) => ({
      id: m.id,
      text: m.message ?? "",
      fromMe: m.from?.id === account.instagramId,
      fromUsername: m.from?.username ?? null,
      createdTime: m.created_time ?? null,
      media: extractMessageMedia(m),
    }));
    if (!contactId) {
      const other = raw.find((m) => m.from?.id && m.from.id !== account.instagramId);
      contactId = other?.from?.id ?? raw[0]?.to?.data?.find((p) => p.id !== account.instagramId)?.id ?? "";
    }
  } catch (err) {
    console.error("[Conversation Messages] API error:", err);
    apiError = err instanceof MetaApiError ? err.message : "Failed to load messages";
  }

  const saved = contactId
    ? await prisma.directMessage.findMany({
        where: { accountId: account.instagramId, contactId },
        orderBy: { sentAt: "asc" },
        take: 500,
        include: { media: { select: { id: true, type: true, status: true, originalUrl: true }, orderBy: { position: "asc" } } },
      })
    : [];

  if (saved.length === 0 && apiError) {
    return NextResponse.json({ success: false, error: apiError }, { status: 500 });
  }

  const byId = new Map<string, ThreadMessage>();
  for (const m of saved) {
    byId.set(m.mid, {
      id: m.mid,
      text: m.text ?? "",
      fromMe: m.fromMe,
      fromUsername: null,
      createdTime: m.sentAt.toISOString(),
      media: m.media
        .filter((x) => x.status !== "expired" || x.type === "share")
        .map((x) => ({
          type: MEDIA_TYPE[x.type] ?? "file",
          // saved → our copy; not saved yet → the route redirects to Meta's link
          url: x.status === "link" ? x.originalUrl : `/api/inbox/media/${x.id}`,
        })),
      template: (m.template as ThreadTemplate | null) ?? null,
      storyReply: m.storyReply,
      deleted: m.deleted,
    });
  }

  // Messages the API knows but the webhook never stored (e.g. before 03/10).
  const missing = apiMessages.filter((m) => !byId.has(m.id));
  const blanks = missing.filter((m) => !m.text && (m.media?.length ?? 0) === 0 && !m.fromMe);
  await Promise.all(
    blanks.map(async (m) => {
      const containment = JSON.stringify({ entry: [{ messaging: [{ message: { mid: m.id } }] }] });
      const rows = await prisma.$queryRaw<{ message: unknown }[]>`
        SELECT msg->'message' AS message
        FROM "WebhookEvent" e,
             jsonb_array_elements(e.payload->'entry') en,
             jsonb_array_elements(en->'messaging') msg
        WHERE e.payload @> ${containment}::jsonb
          AND msg->'message'->>'mid' = ${m.id}
          AND msg->'recipient'->>'id' = ${account.instagramId}
        LIMIT 1`;
      const media = rows[0] ? extractWebhookMedia(rows[0].message) : [];
      if (media.length > 0) m.media = media;
    })
  ).catch((err) => console.warn("[Conversation Messages] Webhook media lookup failed:", err));
  for (const m of missing) byId.set(m.id, m);

  const messages = [...byId.values()].sort(
    (a, b) => new Date(a.createdTime ?? 0).getTime() - new Date(b.createdTime ?? 0).getTime()
  );
  const data: ThreadResponse = { messages, saved: saved.length };
  return NextResponse.json({ success: true, data });
}
