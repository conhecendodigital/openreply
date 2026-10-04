import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { isMetaUrl } from "@/lib/messages/store";
import { mediaHeaders } from "@/lib/messages/media-headers";

type RouteProps = { params: Promise<{ id: string }> };

// Serve a saved DM photo/video/audio to the signed-in workspace. Media not
// saved yet falls back to Meta's original link (may have expired).
export async function GET(_request: NextRequest, { params }: RouteProps) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const media = await prisma.directMedia.findUnique({
    where: { id },
    select: {
      status: true,
      mime: true,
      data: true,
      originalUrl: true,
      message: { select: { workspaceId: true, accountId: true } },
    },
  });
  if (!media) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  // Ownership: the message's workspace, or (old rows without it) an account of this workspace.
  if (media.message.workspaceId !== workspaceId) {
    const owns = await prisma.instagramAccount.count({
      where: { workspaceId, instagramId: media.message.accountId },
    });
    if (!owns) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }

  if (media.status === "saved" && media.data) {
    return new NextResponse(new Uint8Array(media.data), {
      headers: { ...mediaHeaders(media.mime), "Content-Length": String(media.data.length) },
    });
  }
  // Only ever send the viewer back to Meta's CDN, never to any other site.
  if (!isMetaUrl(media.originalUrl)) {
    return NextResponse.json({ success: false, error: "Not found" }, { status: 404 });
  }
  return NextResponse.redirect(media.originalUrl, 302);
}
