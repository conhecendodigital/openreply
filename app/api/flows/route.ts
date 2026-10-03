import { NextRequest } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { FLOW_SELECT, openRunsByFlow } from "@/lib/flows/api";
import { emptyFlowDefinition, flowDefinitionSchema, FLOW_TRIGGERS, MAX_FLOW_NAME } from "@/lib/flows/schema";
import { presentFlow, presentFlowSummary } from "@/lib/flows/service";

export const dynamic = "force-dynamic";

// Flows of the workspace: status, trigger, how many entered / finished.
export async function GET(request: NextRequest) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const account = request.nextUrl.searchParams.get("instagramAccountId");
  const flows = await prisma.flow.findMany({
    where: {
      workspaceId: auth.context.workspaceId,
      ...(account && account !== "all" ? { instagramAccountId: account } : {}),
    },
    select: FLOW_SELECT,
    orderBy: { createdAt: "desc" },
  });
  const list = Array.isArray(flows) ? flows : [];
  const open = await openRunsByFlow(list.map((f) => f.id));
  return ok(list.map((f) => presentFlowSummary(f, open.get(f.id) ?? 0)));
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(MAX_FLOW_NAME),
  instagramAccountId: z.string().min(1).optional().nullable(),
  triggerType: z.enum(FLOW_TRIGGERS).optional(),
  draft: z.unknown().optional(),
});

// A new flow: always OFF and only a draft (API keys too). Publishing and
// turning it on happen in the Lead Engine, by a human.
export async function POST(request: NextRequest) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const parsed = createSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Invalid flow", 400, parsed.error.issues);

  const account = await getWorkspaceInstagramAccount(auth.context.workspaceId, parsed.data.instagramAccountId);
  if (!account) return fail("Connect an Instagram account first", 400, { code: "no_account" });

  let draft = emptyFlowDefinition(parsed.data.triggerType ?? "COMMENT");
  if (parsed.data.draft !== undefined) {
    const def = flowDefinitionSchema.safeParse(parsed.data.draft);
    if (!def.success) return fail("Invalid flow definition", 400, def.error.issues);
    draft = def.data;
  }

  const flow = await prisma.flow.create({
    data: {
      workspaceId: auth.context.workspaceId,
      instagramAccountId: account.id,
      name: parsed.data.name,
      isActive: false,
      draft: draft as unknown as Prisma.InputJsonValue,
      createdBy: auth.context.userId,
    },
    select: FLOW_SELECT,
  });
  return ok(presentFlow(flow), 201);
}
