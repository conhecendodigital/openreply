import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { readFunnelJson, TOO_LARGE } from "@/lib/funnels/limits";
import { prisma } from "@/lib/db/client";
import { FUNNEL_SELECT, liveKeyError, presentFunnelDetail, presentFunnelSummary } from "@/lib/funnels/api";
import { MAX_FUNNEL_NAME, parseFunnelDefinition } from "@/lib/funnels/schema";
import { createFunnel, FunnelError, funnelStats7d } from "@/lib/funnels/service";
import { FUNNEL_STATUSES, type FunnelDefinition } from "@/lib/funnels/types";

export const dynamic = "force-dynamic";

// Funnels (quizzes) of the workspace, newest first. ARCHIVED only on ?status=ARCHIVED.
export async function GET(request: NextRequest) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const raw = request.nextUrl.searchParams.get("status");
  const status = (FUNNEL_STATUSES as readonly string[]).includes(raw ?? "") ? (raw as (typeof FUNNEL_STATUSES)[number]) : null;
  const rows = await prisma.funnel.findMany({
    where: {
      workspaceId: auth.context.workspaceId,
      ...(status ? { status } : { status: { not: "ARCHIVED" } }),
    },
    select: FUNNEL_SELECT,
    orderBy: { updatedAt: "desc" },
  });
  const list = Array.isArray(rows) ? rows : [];
  const stats = await funnelStats7d(list.map((r) => r.id));
  return ok(list.map((r) => presentFunnelSummary(r, stats.get(r.id))));
}

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_FUNNEL_NAME),
    slug: z.string().trim().min(1).max(80).optional(),
    templateId: z.string().trim().min(1).max(60).optional(),
    draft: z.unknown().optional(),
  })
  .strict();

// A new funnel: always DRAFT (API keys too). Publishing is a human, on the screen.
export async function POST(request: NextRequest) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const body = await readFunnelJson(request);
  if (body === TOO_LARGE) return fail("Too large", 413, { code: "too_large" });
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return liveKeyError(parsed.error)
      ? fail("A funnel is born as a draft; publish it on the screen", 400, { code: "draft_only" })
      : fail("Invalid funnel", 400, { code: "invalid_funnel", issues: parsed.error.issues });
  }
  let definition: FunnelDefinition | null = null;
  if (parsed.data.draft !== undefined) {
    const def = parseFunnelDefinition(parsed.data.draft);
    if (!def.ok) return fail("Invalid funnel definition", 400, { code: "invalid_funnel", issues: def.issues });
    definition = def.definition;
  }
  try {
    const row = await createFunnel({
      workspaceId: auth.context.workspaceId,
      userId: auth.context.userId ?? null,
      name: parsed.data.name,
      slug: parsed.data.slug ?? null,
      templateId: parsed.data.templateId ?? null,
      definition,
    });
    return ok(presentFunnelDetail(row), 201);
  } catch (error) {
    if (error instanceof FunnelError) return fail(error.message, error.status, { code: error.code, ...error.extra });
    throw error;
  }
}
