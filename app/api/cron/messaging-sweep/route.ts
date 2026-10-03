import { NextRequest, NextResponse } from "next/server";
import { expireTakeovers } from "@/lib/messaging/takeover";
import { expireDrafts } from "@/lib/drafts/drafts";
import { expireWaitingEnrollments } from "@/lib/sequences/engine";

/**
 * Every 5 minutes (scripts/cron.sh): takeovers past their deadline go off
 * (TAKEOVER_OFF on the timeline; reads already treat them as off), pending
 * drafts whose window closed become EXPIRED, and sequences still waiting for a
 * first reply after 7 days stop. Idempotent.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const [takeovers, drafts, sequences] = await Promise.all([
    expireTakeovers(now),
    expireDrafts(now),
    expireWaitingEnrollments(now),
  ]);
  return NextResponse.json({ success: true, data: { takeovers, drafts, sequences } });
}
