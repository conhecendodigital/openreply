import { NextRequest } from "next/server";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { FLOW_SELECT } from "@/lib/flows/api";
import { campaignToFlowDefinition, CONVERT_WARNING_TEXT } from "@/lib/flows/convert";
import { MAX_FLOW_NAME } from "@/lib/flows/schema";
import { presentFlow } from "@/lib/flows/service";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ automationId: string }> };

// "Abrir como fluxo": creates a NEW flow, OFF, copied from the campaign. The
// campaign is only READ: it stays on and untouched. The owner decides later
// to turn the campaign off and the flow on.
export async function POST(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const { automationId } = await params;
  const campaign = await prisma.automation.findFirst({
    where: { id: automationId, workspaceId: auth.context.workspaceId },
    include: {
      trackedLinks: { select: { label: true, destinationUrl: true }, orderBy: { createdAt: "asc" } },
      sequence: { include: { steps: { orderBy: { order: "asc" } } } },
    },
  });
  if (!campaign) return fail("Campaign not found", 404);

  const { definition, warnings } = campaignToFlowDefinition({
    ...campaign,
    trigger: campaign.trigger,
    sequenceSteps: campaign.sequence?.steps ?? [],
  });
  const flow = await prisma.flow.create({
    data: {
      workspaceId: auth.context.workspaceId,
      instagramAccountId: campaign.instagramAccountId,
      name: `${campaign.name} (fluxo)`.slice(0, MAX_FLOW_NAME),
      isActive: false,
      draft: definition as unknown as Prisma.InputJsonValue,
      sourceAutomationId: campaign.id,
      createdBy: auth.context.userId,
    },
    select: FLOW_SELECT,
  });
  return ok(
    {
      ...presentFlow(flow),
      warnings: warnings.map((code) => ({ code, message: CONVERT_WARNING_TEXT[code] })),
    },
    201
  );
}
