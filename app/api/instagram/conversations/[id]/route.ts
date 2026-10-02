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

export interface ThreadMessage {
  id: string;
  text: string;
  fromMe: boolean;
  fromUsername: string | null;
  createdTime: string | null;
  media?: MessageMedia[];
}

export interface ThreadResponse {
  messages: ThreadMessage[];
}

type RouteProps = { params: Promise<{ id: string }> };

// Message history for a single conversation (20 most recent, chronological).
export async function GET(request: NextRequest, { params }: RouteProps) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { id: conversationId } = await params;

  const account = await getWorkspaceInstagramAccount(
    workspaceId,
    request.nextUrl.searchParams.get("instagramAccountId")
  );
  if (!account) {
    return NextResponse.json(
      { success: false, error: "Instagram account not connected." },
      { status: 400 }
    );
  }

  try {
    const accessToken = decryptToken(account.accessToken);
    const raw = await getConversationMessages(accessToken, conversationId);

    // The API returns newest-first; reverse to read top-to-bottom.
    const messages: ThreadMessage[] = raw
      .map((m) => ({
        id: m.id,
        text: m.message ?? "",
        fromMe: m.from?.id === account.instagramId,
        fromUsername: m.from?.username ?? null,
        createdTime: m.created_time ?? null,
        media: extractMessageMedia(m),
      }))
      .reverse();

    // The Conversations API leaves some media out (voice notes came back empty
    // in testing), but the webhook for the same message carries it. Fill those
    // gaps from the stored webhook event, matched by message id.
    const blanks = messages.filter((m) => !m.text && (m.media?.length ?? 0) === 0 && !m.fromMe);
    await Promise.all(
      blanks.map(async (m) => {
        const containment = JSON.stringify({ entry: [{ messaging: [{ message: { mid: m.id } }] }] });
        const rows = await prisma.$queryRaw<{ message: unknown }[]>`
          SELECT msg->'message' AS message
          FROM "WebhookEvent" e,
               jsonb_array_elements(e.payload->'entry') en,
               jsonb_array_elements(en->'messaging') msg
          WHERE e."workspaceId" = ${workspaceId}
            AND e.payload @> ${containment}::jsonb
            AND msg->'message'->>'mid' = ${m.id}
          LIMIT 1`;
        const media = rows[0] ? extractWebhookMedia(rows[0].message) : [];
        if (media.length > 0) m.media = media;
      })
    ).catch((err) => console.warn("[Conversation Messages] Webhook media lookup failed:", err));

    const data: ThreadResponse = { messages };
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("[Conversation Messages] Error:", err);
    const message =
      err instanceof MetaApiError ? err.message : "Failed to load messages";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
