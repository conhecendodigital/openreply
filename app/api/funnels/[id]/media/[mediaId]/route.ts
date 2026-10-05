import { NextRequest } from "next/server";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { prisma } from "@/lib/db/client";
import { humanOnly } from "@/lib/funnels/api";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string; mediaId: string }> };

/** The browser finished the upload: the file shows in "already sent". Same workspace only. */
export async function PATCH(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("upload files");
  if (blocked) return blocked;
  const { id, mediaId } = await params;
  const result = await prisma.funnelMedia.updateMany({
    where: { id: mediaId, funnelId: id, workspaceId: auth.context.workspaceId, uploadedAt: null },
    data: { uploadedAt: new Date() },
  });
  if (!result || result.count === 0) {
    const exists = await prisma.funnelMedia.findFirst({
      where: { id: mediaId, funnelId: id, workspaceId: auth.context.workspaceId },
      select: { id: true },
    });
    if (!exists) return fail("File not found", 404);
  }
  return ok({ id: mediaId, uploaded: true });
}
