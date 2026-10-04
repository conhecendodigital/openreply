/**
 * Every message WE send goes through sendTracked, which keeps the
 * OutboundMessage ledger:
 *   1. the row is written BEFORE the POST (mid null), because the echo webhook
 *      can arrive before Meta answers the POST;
 *   2. the message carries metadata "le:<origin>:<rowId>";
 *   3. the mid Meta returns is stored on the row.
 * An echo is then "ours" when its metadata starts with "le:", or its mid is in
 * the ledger, or (late) its text matches a recent row. Anything else was typed
 * by the owner on the phone and turns human takeover on.
 */
import { prisma } from "@/lib/db/client";
import type { SendOptions } from "@/lib/meta/client";
import { assertAccountActive, noteMetaError } from "@/lib/channels/status";

export const OUTBOUND_ORIGINS = [
  "automation",
  "followup",
  "sequence",
  "draft",
  "inbox",
  "private_reply",
  // Etapa 3: a flow message (refId = FlowRun.id).
  "flow",
  // Etapa 5: a broadcast (refId = BroadcastRecipient.id). Never a message tag.
  "broadcast",
] as const;
export type OutboundOrigin = (typeof OUTBOUND_ORIGINS)[number];

export const METADATA_PREFIX = "le:";

export type OutboundContext = {
  workspaceId: string;
  /** Internal InstagramAccount.id. */
  instagramAccountId: string;
  /** The person (IGSID); for a private reply, the commenter. */
  contactIgUserId: string;
  origin: OutboundOrigin;
  refId?: string | null;
  text?: string | null;
};

export function buildMetadata(origin: OutboundOrigin, rowId: string): string {
  return `${METADATA_PREFIX}${origin}:${rowId}`;
}

/** {origin, rowId} out of our metadata, or null when it is not ours. */
export function parseMetadata(
  metadata: string | null | undefined
): { origin: string; rowId: string | null } | null {
  if (!metadata || !metadata.startsWith(METADATA_PREFIX)) return null;
  const [origin, rowId] = metadata.slice(METADATA_PREFIX.length).split(":");
  return { origin: origin || "unknown", rowId: rowId || null };
}

const MAX_TEXT = 2000;

export async function sendTracked<T extends { message_id?: string }>(
  ctx: OutboundContext,
  send: (options: SendOptions) => Promise<T>
): Promise<T> {
  // A channel that is not ACTIVE (disconnected / needs reconnect) never sends.
  // Throws ChannelOffError before anything is written.
  await assertAccountActive(ctx.instagramAccountId);

  let rowId: string | null = null;
  try {
    const row = await prisma.outboundMessage.create({
      data: {
        workspaceId: ctx.workspaceId,
        instagramAccountId: ctx.instagramAccountId,
        contactIgUserId: ctx.contactIgUserId,
        origin: ctx.origin,
        refId: ctx.refId ?? null,
        text: ctx.text ? ctx.text.slice(0, MAX_TEXT) : null,
      },
      select: { id: true },
    });
    rowId = row?.id ?? null;
  } catch (error) {
    // The ledger must never cost a DM: the metadata alone still marks it ours.
    console.warn("[Outbound] Ledger write failed:", error instanceof Error ? error.message : error);
  }

  let result: T;
  try {
    result = await send({ metadata: buildMetadata(ctx.origin, rowId ?? "x") });
  } catch (error) {
    // Meta rejected the token: flag the channel "needs reconnect".
    await noteMetaError({ id: ctx.instagramAccountId }, error);
    if (rowId) {
      await prisma.outboundMessage
        .update({
          where: { id: rowId },
          data: { error: (error instanceof Error ? error.message : "send failed").slice(0, 500) },
        })
        .catch(() => undefined);
    }
    throw error;
  }

  if (rowId && result?.message_id) {
    await prisma.outboundMessage
      .update({ where: { id: rowId }, data: { mid: result.message_id } })
      .catch(() => undefined);
  }
  return result;
}
