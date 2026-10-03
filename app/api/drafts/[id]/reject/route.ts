import { NextRequest } from "next/server";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { getApiCaller } from "@/lib/auth";
import { rejectDraft } from "@/lib/drafts/drafts";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

// Discard a PENDING draft. Nothing is sent.
export async function POST(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const caller = await getApiCaller();
  const by = caller.kind === "session" ? auth.context.userId : "mcp";
  const result = await rejectDraft({ workspaceId: auth.context.workspaceId, id, by });
  if (!result.ok) return fail(result.error, result.status, { code: result.code });
  return ok({ id, status: "REJECTED" });
}
