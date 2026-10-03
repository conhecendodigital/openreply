/**
 * Was this echo (a message the account sent) ours, or did the owner type it
 * on the phone / Business Suite / another app? Layers, strongest first:
 *   1. metadata "le:..." that we attached on send;
 *   2. its mid is in the OutboundMessage ledger;
 *   3. a button/generic template (the phone app cannot send one);
 *   4. late pass only (the echo can beat the POST's answer, so the worker
 *      retries once ~20 s later): same text sent by us to the same person in
 *      the 2 minutes before it (ChatbotX's isEchoOfOwnSend).
 * Anything left is "phone": takeover turns on. In doubt we pause the robot,
 * because the robot talking over the owner is the worse mistake.
 */
import { prisma } from "@/lib/db/client";
import { parseMetadata } from "@/lib/meta/send";

export const ECHO_RECHECK_DELAY_MS = 20_000;
const TEXT_MATCH_WINDOW_MS = 2 * 60_000;

export type EchoInput = {
  /** Internal InstagramAccount.id. */
  instagramAccountId: string;
  contactIgUserId: string;
  mid: string;
  text: string | null;
  metadata: string | null;
  hasTemplate?: boolean;
  sentAt: Date;
};

export type EchoVerdict =
  | { kind: "ours"; origin: string; via: "metadata" | "ledger" | "template" | "text" }
  | { kind: "unknown" }
  | { kind: "phone" };

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export async function classifyEcho(input: EchoInput, options: { late: boolean }): Promise<EchoVerdict> {
  const meta = parseMetadata(input.metadata);
  if (meta) return { kind: "ours", origin: meta.origin, via: "metadata" };

  const row = await prisma.outboundMessage.findUnique({
    where: { mid: input.mid },
    select: { origin: true },
  });
  if (row) return { kind: "ours", origin: row.origin, via: "ledger" };

  if (input.hasTemplate) return { kind: "ours", origin: "template", via: "template" };

  if (!options.late) return { kind: "unknown" };

  if (input.text) {
    const recent = await prisma.outboundMessage.findMany({
      where: {
        instagramAccountId: input.instagramAccountId,
        contactIgUserId: input.contactIgUserId,
        createdAt: {
          gte: new Date(input.sentAt.getTime() - TEXT_MATCH_WINDOW_MS),
          lte: new Date(input.sentAt.getTime() + TEXT_MATCH_WINDOW_MS),
        },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { origin: true, text: true },
    });
    const wanted = normalize(input.text);
    const match = recent.find((r) => r.text && normalize(r.text) === wanted);
    if (match) return { kind: "ours", origin: match.origin, via: "text" };
  }
  return { kind: "phone" };
}
