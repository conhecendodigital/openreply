import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { handleDeauthorize } from "@/lib/meta/data-callbacks";
import { parseSignedRequest, readSignedRequestField, signedRequestSecrets } from "@/lib/meta/signed-request";

/**
 * Deauthorize callback (Meta App Dashboard > Instagram > API setup with
 * Instagram login > Business login settings > Deauthorize callback URL).
 *
 * Someone removed Lead Engine from Instagram: the account goes DISCONNECTED
 * and its token is wiped. Owner's rule: this never deletes conversations,
 * contacts or automations (deleting is the data deletion callback or the
 * "Delete for real" button).
 */
export async function POST(request: NextRequest) {
  const secrets = signedRequestSecrets();
  if (secrets.length === 0) {
    return NextResponse.json({ error: "Deauthorize is not configured" }, { status: 500 });
  }

  const parsed = parseSignedRequest(await readSignedRequestField(request), secrets);
  if (!parsed.ok) {
    await prisma.operationalEvent
      .create({
        data: {
          source: "SYSTEM",
          level: "WARNING",
          message: "Meta deauthorize callback rejected (nothing changed)",
          payload: { reason: parsed.reason },
        },
      })
      .catch(() => undefined);
    return NextResponse.json({ error: "Invalid signed_request", reason: parsed.reason }, { status: 400 });
  }

  const outcome = await handleDeauthorize(parsed.payload.user_id);
  return NextResponse.json({ success: true, result: outcome.result });
}
