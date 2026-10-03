import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { buildIgMeUrl, isValidCode } from "@/lib/conversation-links/links";

type RouteProps = { params: Promise<{ code: string }> };

/**
 * /c/<code>: counted redirect to ig.me/m/<user>?ref=<code>, for a story sticker
 * or the bio. ig.me itself only tells us who opened the conversation; this
 * counts the taps. Public on purpose (like /r/<slug>); counts nothing else.
 */
export async function GET(request: NextRequest, { params }: RouteProps) {
  const { code } = await params;
  if (!isValidCode(code)) return NextResponse.redirect(new URL("/", request.url), { status: 302 });

  const link = await prisma.conversationLink.findUnique({
    where: { code },
    select: { id: true, isActive: true, instagramAccount: { select: { username: true } } },
  });
  if (!link || !link.isActive) return NextResponse.redirect(new URL("/", request.url), { status: 302 });

  await prisma.conversationLink
    .update({ where: { id: link.id }, data: { clicks: { increment: 1 } } })
    .catch(() => undefined);
  return NextResponse.redirect(buildIgMeUrl(link.instagramAccount.username, code), { status: 302 });
}
