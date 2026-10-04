import { NextRequest } from "next/server";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { humanOnly } from "@/lib/segments/api";
import { sendBroadcastSchema } from "@/lib/broadcasts/schema";
import {
  broadcastAudience,
  BroadcastSendError,
  findBroadcast,
  presentBroadcast,
  sendBroadcast,
} from "@/lib/broadcasts/service";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

const STATUS_BY_CODE: Record<BroadcastSendError["code"], number> = {
  not_draft: 409,
  channel_off: 409,
  flow_off: 409,
  too_far: 400,
  no_text: 400,
};

// Send now or schedule. Signed-in OWNER/ADMIN only: an API key gets 403
// human_only (it may only create drafts). The recipients are picked when it
// starts: only people whose 24 h conversation is open at that moment.
export async function POST(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("send broadcasts");
  if (blocked) return blocked;
  const parsed = sendBroadcastSchema.safeParse((await readJson(request)) ?? {});
  if (!parsed.success) return fail("Send { scheduledAt?: ISO date }", 400, parsed.error.issues);
  const { id } = await params;
  const broadcast = await findBroadcast(id, auth.context.workspaceId);
  if (!broadcast) return fail("Broadcast not found", 404);
  const expected = parsed.data.expectedUpdatedAt ? new Date(parsed.data.expectedUpdatedAt).getTime() : null;
  if (expected !== null && broadcast.updatedAt && new Date(broadcast.updatedAt).getTime() !== expected) {
    // Someone (e.g. the AI's API key) changed the draft after the person read it.
    return fail("The draft changed since you opened it. Reload and read it again before sending.", 409, {
      code: "changed",
    });
  }

  const audience = await broadcastAudience(broadcast);
  try {
    const result = await sendBroadcast(broadcast, {
      userId: auth.context.userId,
      scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
    });
    const updated = await findBroadcast(id, auth.context.workspaceId);
    return ok({ ...(updated ? presentBroadcast(updated) : {}), scheduledAt: result.scheduledAt, audience });
  } catch (error) {
    if (error instanceof BroadcastSendError) {
      return fail(error.message, STATUS_BY_CODE[error.code] ?? 400, { code: error.code });
    }
    throw error;
  }
}
