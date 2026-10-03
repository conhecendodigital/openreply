import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { intParam, ok, requireContext } from "@/lib/api-helpers";
import { CONTEXT_CONTACT_SELECT, presentContact } from "@/lib/inbox/context";
import { isTakeoverActive } from "@/lib/messaging/takeover";
import { DEFAULT_WINDOW_MARGIN_MIN, WINDOW_MS } from "@/lib/messaging/window";

export const dynamic = "force-dynamic";

const MAX_LOOKBACK_DAYS = 30;

/**
 * People whose last DM has no answer from us yet, newest first, with tags, the
 * last messages and the window. Never lists anyone a human took over. By
 * default only open windows (the only ones we can still answer);
 * ?incluirFechadas=true also lists closed ones from the last 30 days.
 *
 * "No answer" is read from the stored DM history (DirectMessage, written by
 * the webhook itself) so it is right even while the CRM job is a few seconds
 * behind; lastInboundAt/lastOutboundAt only pick the candidates.
 */
export async function GET(request: NextRequest) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { workspaceId } = auth.context;

  const params = request.nextUrl.searchParams;
  const limit = intParam(params.get("limite") ?? params.get("limit"), 20, 1, 50);
  const includeClosed = ["1", "true", "sim"].includes((params.get("incluirFechadas") ?? params.get("includeClosed") ?? "").toLowerCase());
  const instagramAccountId = params.get("instagramAccountId");
  const now = new Date();
  const since = includeClosed
    ? new Date(now.getTime() - MAX_LOOKBACK_DAYS * 86_400_000)
    : new Date(now.getTime() - WINDOW_MS + DEFAULT_WINDOW_MARGIN_MIN * 60_000);

  const candidates = await prisma.contact.findMany({
    where: {
      workspaceId,
      ...(instagramAccountId && instagramAccountId !== "all" ? { instagramAccountId } : {}),
      lastInboundAt: { gte: since },
    },
    orderBy: { lastInboundAt: "desc" },
    take: Math.min(300, limit * 5),
    select: {
      ...CONTEXT_CONTACT_SELECT,
      draftReplies: { where: { status: "PENDING" }, select: { id: true, text: true }, take: 1 },
    },
  });

  const out = [];
  for (const contact of candidates) {
    if (out.length >= limit) break;
    if (isTakeoverActive(contact, now)) continue;
    const presented = await presentContact(contact, { messages: 5, now });
    const last = presented.lastMessages[presented.lastMessages.length - 1];
    const unanswered = last
      ? !last.fromMe
      : Boolean(contact.lastInboundAt && (!contact.lastOutboundAt || contact.lastInboundAt > contact.lastOutboundAt));
    if (!unanswered) continue;
    out.push({ ...presented, pendingDraft: contact.draftReplies[0] ?? null });
  }
  return ok({ contacts: out, includeClosed });
}
