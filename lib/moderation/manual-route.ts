import type { NextRequest } from "next/server";
import { isApiTokenRequest } from "@/lib/auth";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { setModerationHidden } from "@/lib/moderation/moderate";

type RouteProps = { params: Promise<{ id: string }> };

/** POST handler for /api/moderation/log/[id]/restore and /hide. */
export function manualModerationHandler(hidden: boolean) {
  return async function POST(_request: NextRequest, { params }: RouteProps) {
    const auth = await requireContext({ manage: true });
    if ("response" in auth) return auth.response;
    const { id } = await params;
    if (!id) return fail("Missing id", 400);

    const actor = (await isApiTokenRequest()) ? "mcp" : auth.context.userId;
    const result = await setModerationHidden({
      moderationId: id,
      workspaceId: auth.context.workspaceId,
      hidden,
      actor,
    });
    if (!result.ok) return fail(result.error, result.status);
    return ok(result.row);
  };
}
