import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getRequestIp, hashClickIp } from "@/lib/tracking/server";
import { RECIPIENT_PARAM, verifyRecipientToken } from "@/lib/tracking/recipient";
import { AUTO_TAGS, trackInteraction } from "@/lib/contacts/record";

type RedirectRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function GET(request: NextRequest, { params }: RedirectRouteProps) {
  const { slug } = await params;
  const trackedLink = await prisma.trackedLink.findUnique({
    where: { slug },
    select: {
      id: true,
      workspaceId: true,
      automationId: true,
      destinationUrl: true,
      automation: {
        select: {
          instagramAccountId: true,
        },
      },
    },
  });

  if (!trackedLink) {
    return NextResponse.redirect(new URL("/", request.url), { status: 302 });
  }

  // DM buttons carry ?c=<igsid>.<sig>: who received this link. Public links
  // (comment replies, shared reports) have none and stay anonymous.
  const contactIgUserId = verifyRecipientToken(
    slug,
    new URL(request.url).searchParams.get(RECIPIENT_PARAM)
  );

  const click = await prisma.linkClick.create({
    data: {
      workspaceId: trackedLink.workspaceId,
      automationId: trackedLink.automationId,
      instagramAccountId: trackedLink.automation.instagramAccountId,
      trackedLinkId: trackedLink.id,
      ipHash: hashClickIp(getRequestIp(request)),
      userAgent: request.headers.get("user-agent"),
      referrer: request.headers.get("referer"),
      ...(contactIgUserId ? { contactIgUserId } : {}),
    },
  });

  if (contactIgUserId && click?.id) {
    // CRM never delays or breaks the redirect.
    await creditClick({
      clickId: click.id,
      clickedAt: click.createdAt ?? new Date(),
      igUserId: contactIgUserId,
      workspaceId: trackedLink.workspaceId,
      automationId: trackedLink.automationId,
      instagramAccountId: trackedLink.automation.instagramAccountId,
    }).catch(() => {});
  }

  return NextResponse.redirect(trackedLink.destinationUrl, { status: 302 });
}

async function creditClick(input: {
  clickId: string;
  clickedAt: Date;
  igUserId: string;
  workspaceId: string;
  automationId: string;
  instagramAccountId: string;
}) {
  const [account, automation, dmLog] = await Promise.all([
    prisma.instagramAccount.findUnique({
      where: { id: input.instagramAccountId },
      select: { id: true, workspaceId: true, instagramId: true },
    }),
    prisma.automation.findUnique({
      where: { id: input.automationId },
      select: { name: true },
    }),
    prisma.dmLog.findFirst({
      where: { automationId: input.automationId, commenterId: input.igUserId, status: "SENT" },
      orderBy: { dmSentAt: "desc" },
      select: { id: true },
    }),
  ]);
  if (!account || account.workspaceId !== input.workspaceId) return;

  if (dmLog) {
    await prisma.linkClick.update({ where: { id: input.clickId }, data: { dmLogId: dmLog.id } });
  }

  await trackInteraction({
    account,
    igUserId: input.igUserId,
    event: {
      type: "CLICK",
      refId: input.clickId,
      occurredAt: input.clickedAt,
      automationId: input.automationId,
      text: automation?.name ?? null,
    },
    tags: [
      AUTO_TAGS.clicked,
      ...(automation?.name ? [AUTO_TAGS.clickedCampaign(automation.name)] : []),
    ],
  });
}
