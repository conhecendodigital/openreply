import { NextRequest, NextResponse } from "next/server";
import { expireTakeovers } from "@/lib/messaging/takeover";
import { expireDrafts } from "@/lib/drafts/drafts";
import { expireWaitingEnrollments } from "@/lib/sequences/engine";
import { sweepBroadcasts } from "@/lib/broadcasts/engine";
import { isCronAuthorized } from "@/lib/cron-auth";

/**
 * Every 5 minutes (scripts/cron.sh): takeovers past their deadline go off
 * (TAKEOVER_OFF on the timeline; reads already treat them as off), pending
 * drafts whose window closed become EXPIRED, and sequences still waiting for a
 * first reply after 7 days stop. Etapa 5: broadcasts whose start job was
 * lost start, a broadcast whose next batch is 10 min late resumes, and a
 * recipient stuck in SENDING becomes MAYBE_SENT (never resent). Idempotent.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const [takeovers, drafts, sequences, broadcasts] = await Promise.all([
    expireTakeovers(now),
    expireDrafts(now),
    expireWaitingEnrollments(now),
    sweepBroadcasts(now).catch((error) => {
      console.warn("[Sweep] broadcasts:", error instanceof Error ? error.message : error);
      return null;
    }),
  ]);
  return NextResponse.json({ success: true, data: { takeovers, drafts, sequences, broadcasts } });
}
