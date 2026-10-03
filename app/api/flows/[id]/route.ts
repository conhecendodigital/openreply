import { NextRequest } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { FLOW_SELECT, findFlow, humanOnly, openRunsByFlow } from "@/lib/flows/api";
import { flowDefinitionSchema, MAX_FLOW_NAME } from "@/lib/flows/schema";
import { definitionOrNull, findCampaignConflicts, presentFlow } from "@/lib/flows/service";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const flow = await findFlow(id, auth.context.workspaceId);
  if (!flow) return fail("Flow not found", 404);
  const open = await openRunsByFlow([flow.id]);
  const def = definitionOrNull(flow.published) ?? definitionOrNull(flow.draft);
  const conflicts = def ? await findCampaignConflicts(flow.instagramAccountId, def.trigger) : [];
  const links = await prisma.flowLink.findMany({
    where: { flowId: flow.id },
    select: { nodeId: true, buttonId: true, slug: true, destinationUrl: true },
  });
  return ok({ ...presentFlow(flow, open.get(flow.id) ?? 0), conflicts, links: Array.isArray(links) ? links : [] });
}

// Only the draft and the name. `isActive` / `published` are not accepted
// here (strict): publish and on/off have their own human-only routes.
const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_FLOW_NAME).optional(),
    draft: z.unknown().optional(),
    instagramAccountId: z.string().min(1).optional(),
  })
  .strict();

export async function PATCH(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const flow = await findFlow(id, auth.context.workspaceId);
  if (!flow) return fail("Flow not found", 404);

  const parsed = patchSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    const touchesLive = parsed.error.issues.some(
      (i) => i.code === "unrecognized_keys" && (i.keys.includes("isActive") || i.keys.includes("published"))
    );
    return touchesLive
      ? fail("Publish and turn flows on or off with their own buttons", 400, { code: "draft_only" })
      : fail("Invalid flow", 400, parsed.error.issues);
  }
  const data: Prisma.FlowUpdateInput = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;
  if (parsed.data.draft !== undefined) {
    const def = flowDefinitionSchema.safeParse(parsed.data.draft);
    if (!def.success) return fail("Invalid flow definition", 400, def.error.issues);
    data.draft = def.data as unknown as Prisma.InputJsonValue;
  }
  if (parsed.data.instagramAccountId !== undefined && parsed.data.instagramAccountId !== flow.instagramAccountId) {
    // Moving a running flow to another account would change who it answers.
    if (flow.isActive || flow.published) return fail("A published flow stays on its account", 409, { code: "published" });
    const account = await prisma.instagramAccount.findFirst({
      where: { id: parsed.data.instagramAccountId, workspaceId: auth.context.workspaceId },
      select: { id: true },
    });
    if (!account) return fail("Instagram account not found", 404);
    data.instagramAccount = { connect: { id: account.id } };
  }
  if (Object.keys(data).length === 0) return fail("Nothing to change", 400);

  const updated = await prisma.flow.update({
    where: { id: flow.id },
    data,
    select: FLOW_SELECT,
  });
  return ok(presentFlow(updated));
}

// Deleting is a human decision and only for a flow that is off.
export async function DELETE(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("delete flows");
  if (blocked) return blocked;
  const { id } = await params;
  const flow = await findFlow(id, auth.context.workspaceId);
  if (!flow) return fail("Flow not found", 404);
  if (flow.isActive) return fail("Turn the flow off before deleting it", 409, { code: "active" });
  await prisma.flow.delete({ where: { id: flow.id } });
  return ok({ id: flow.id, deleted: true });
}
