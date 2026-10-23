import { NextRequest } from "next/server";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { prisma } from "@/lib/db/client";
import { humanOnly } from "@/lib/flows/api";
import { postDto } from "@/lib/tiktok/dto";
import { findPost } from "@/lib/tiktok/posts-api";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/** Desagenda: volta pra rascunho. Só pessoa logada. */
export async function POST(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("cancel scheduled posts");
  if (blocked) return blocked;

  const { id } = await params;
  const post = await findPost(id, auth.context.workspaceId);
  if (!post) return fail("Post not found", 404);

  const changed = await prisma.scheduledPost.updateMany({
    where: { id, status: "SCHEDULED" },
    data: { status: "DRAFT", scheduledAt: null },
  });
  if (changed.count !== 1) return fail("Only a scheduled post can be canceled", 409, { code: "not_scheduled" });
  const updated = await findPost(id, auth.context.workspaceId);
  return ok(postDto(updated ?? { ...post, status: "DRAFT", scheduledAt: null }));
}
