import { NextRequest } from "next/server";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { cancelBroadcast } from "@/lib/broadcasts/engine";
import { callerVia } from "@/lib/segments/api";
import { findBroadcast, presentBroadcast } from "@/lib/broadcasts/service";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

// Stop a scheduled or sending broadcast (or discard a draft as canceled).
// Stopping is always safe, so an API key may do it too. Whoever is still
// PENDING becomes SKIPPED_CANCELED; the one send in flight, if any, finishes.
export async function POST(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const broadcast = await findBroadcast(id, auth.context.workspaceId);
  if (!broadcast) return fail("Broadcast not found", 404);
  const by = (await callerVia()) === "mcp" ? "mcp" : auth.context.userId;
  const canceled = await cancelBroadcast(broadcast.id, auth.context.workspaceId, by);
  if (!canceled) return fail("This broadcast already finished", 409, { code: "finished" });
  const updated = await findBroadcast(id, auth.context.workspaceId);
  return ok(updated ? presentBroadcast(updated) : { id, status: "CANCELED" });
}
