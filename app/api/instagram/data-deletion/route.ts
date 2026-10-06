import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { handleDataDeletion } from "@/lib/meta/data-callbacks";
import { parseSignedRequest, readSignedRequestField, signedRequestSecrets } from "@/lib/meta/signed-request";

/**
 * Data Deletion Request callback (Meta App Dashboard > Instagram > API setup
 * with Instagram login > Business login settings > Data deletion request URL).
 *
 * Meta POSTs application/x-www-form-urlencoded with `signed_request`. A bad
 * signature or a wrong algorithm is a 400 and nothing is deleted. A valid
 * request always gets { url, confirmation_code }, even when no account
 * matches (then nothing is deleted and the request is kept for a manual look).
 */
export async function POST(request: NextRequest) {
  const secrets = signedRequestSecrets();
  if (secrets.length === 0) {
    return NextResponse.json({ error: "Data deletion is not configured" }, { status: 500 });
  }

  const parsed = parseSignedRequest(await readSignedRequestField(request), secrets);
  if (!parsed.ok) {
    await prisma.operationalEvent
      .create({
        data: {
          source: "SYSTEM",
          level: "WARNING",
          message: "Meta data deletion callback rejected (nothing deleted)",
          payload: { reason: parsed.reason },
        },
      })
      .catch(() => undefined);
    return NextResponse.json({ error: "Invalid signed_request", reason: parsed.reason }, { status: 400 });
  }

  const outcome = await handleDataDeletion(parsed.payload.user_id);
  const url = `${getBaseUrl().replace(/\/+$/, "")}/data-deletion/status?code=${outcome.confirmationCode}`;
  return NextResponse.json({ url, confirmation_code: outcome.confirmationCode });
}
