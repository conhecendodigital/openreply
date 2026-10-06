import { NextRequest, NextResponse } from "next/server";
import { getApiCaller, getCurrentWorkspaceId } from "@/lib/auth";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { sendTracked } from "@/lib/meta/send";
import { startTakeover } from "@/lib/messaging/takeover";
import { upsertContact } from "@/lib/contacts/record";
import { saveKnownUsernames } from "@/lib/contacts/profile";
import { requireActiveInstagramAccount } from "@/lib/instagram-accounts";
import { isChannelOffError, noteMetaError } from "@/lib/channels/status";
import {
  getConversations,
  sendDirectMessage,
  MetaApiError,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { extractMessageMedia, mediaLabel } from "@/lib/meta/message-media";
import { previewTextsByMid } from "@/lib/messages/preview";

export interface ConversationListItem {
  id: string;
  contact: { id: string; username: string | null };
  updatedTime: string | null;
  lastMessage: {
    text: string;
    fromMe: boolean;
    createdTime: string | null;
  } | null;
}

export interface ConversationsResponse {
  conversations: ConversationListItem[];
  account: { id: string; username: string; instagramId: string };
}

// List the account's DM conversations for the inbox.
export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const resolved = await requireActiveInstagramAccount(
    workspaceId,
    request.nextUrl.searchParams.get("instagramAccountId")
  );
  if (!resolved.ok) return resolved.response;
  const account = resolved.account;

  try {
    const accessToken = decryptToken(account.accessToken);
    const raw = await getConversations(accessToken, account.instagramId);

    const conversations: ConversationListItem[] = raw.map((c) => {
      const participants = c.participants?.data ?? [];
      const contact =
        participants.find((p) => p.id !== account.instagramId) ??
        participants[0] ??
        null;
      const last = c.messages?.data?.[0] ?? null;

      return {
        id: c.id,
        contact: {
          id: contact?.id ?? "",
          username: contact?.username ?? null,
        },
        updatedTime: c.updated_time ?? null,
        lastMessage: last
          ? {
              // A photo/video-only message has no text: show what it is instead.
              text: last.message || mediaLabel(extractMessageMedia(last)),
              fromMe: last.from?.id === account.instagramId,
              createdTime: last.created_time ?? null,
            }
          : null,
      };
    });

    // A campaign card (button template) comes back with an empty text: show
    // the text inside the card (stored from the echo) or what we sent.
    const blanks = raw
      .map((c, i) => ({ i, last: c.messages?.data?.[0] }))
      .filter(({ i, last }) => last?.id && !conversations[i].lastMessage?.text);
    if (blanks.length > 0) {
      const texts = await previewTextsByMid(
        account,
        blanks.map(({ last }) => last?.id as string)
      );
      for (const { i, last } of blanks) {
        const text = texts.get(last?.id as string);
        const preview = conversations[i].lastMessage;
        if (text && preview) preview.text = text;
      }
    }

    // The participants already carry the @: save it on contacts that have
    // none (people who came by DM), no extra Meta call. Never throws.
    await saveKnownUsernames(
      account.id,
      conversations.map((c) => ({ igUserId: c.contact.id, username: c.contact.username }))
    );

    const data: ConversationsResponse = {
      conversations,
      account: {
        id: account.id,
        username: account.username,
        instagramId: account.instagramId,
      },
    };
    return NextResponse.json({ success: true, data });
  } catch (err) {
    console.error("[Conversations] Error:", err);
    await noteMetaError({ id: account.id }, err);
    const message =
      err instanceof MetaApiError
        ? err.message
        : "Failed to load conversations";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

// Send a direct message reply, typed by a human in the Lead Engine inbox.
// 2026-10-04: API keys cannot use this any more (the MCP's enviar_dm sent DMs
// with no human approval). The AI proposes with POST /api/drafts and a human
// approves. A manual send turns human takeover on for that person.
export async function POST(request: NextRequest) {
  const caller = await getApiCaller();
  if (caller.kind === "token") {
    return NextResponse.json(
      {
        success: false,
        error:
          "API keys cannot send DMs directly. Propose a draft (POST /api/drafts) and a human approves it.",
        code: "human_only",
      },
      { status: 403 }
    );
  }
  const context = await getCurrentWorkspaceContext();
  if (!context) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  const workspaceId = context.workspaceId;

  let body: { instagramAccountId?: string; recipientId?: string; text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 }
    );
  }

  const text = body.text?.trim();
  if (!body.recipientId || !text) {
    return NextResponse.json(
      { success: false, error: "A recipient and message are required." },
      { status: 400 }
    );
  }

  const resolved = await requireActiveInstagramAccount(
    workspaceId,
    body.instagramAccountId ?? null
  );
  if (!resolved.ok) return resolved.response;
  const account = resolved.account;

  const recipientId = body.recipientId;
  try {
    const accessToken = decryptToken(account.accessToken);
    const result = await sendTracked(
      {
        workspaceId,
        instagramAccountId: account.id,
        contactIgUserId: recipientId,
        origin: "inbox",
        refId: context.userId,
        text,
      },
      (options) => sendDirectMessage(accessToken, account.instagramId, recipientId, text, options)
    );

    // The owner is answering by hand: the robot steps aside for this person.
    let takeoverUntil: Date | null = null;
    try {
      const contact = await upsertContact({
        workspaceId,
        instagramAccountId: account.id,
        igUserId: recipientId,
        at: new Date(),
      });
      takeoverUntil =
        (await startTakeover({ contactId: contact.id, by: context.userId, reason: "inbox_send" }))?.until ?? null;
    } catch (error) {
      console.warn("[Conversations] Could not start takeover:", error);
    }
    return NextResponse.json({ success: true, data: { ...result, takeoverUntil } });
  } catch (err) {
    if (isChannelOffError(err)) {
      return NextResponse.json({ success: false, error: err.message, code: err.code }, { status: 409 });
    }
    console.error("[Conversations] Send error:", err);
    // Surface Meta's own message — the common case is the 24-hour messaging
    // window having closed, which the user needs to see explicitly.
    const message =
      err instanceof MetaApiError ? err.message : "Failed to send message";
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
