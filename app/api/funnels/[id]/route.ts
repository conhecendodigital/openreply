import { NextRequest } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/app/generated/prisma/client";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { readFunnelJson, TOO_LARGE } from "@/lib/funnels/limits";
import { prisma } from "@/lib/db/client";
import { FUNNEL_SELECT, findFunnel, humanOnly, liveKeyError, presentFunnelDetail } from "@/lib/funnels/api";
import { definitionOrNull, MAX_FUNNEL_NAME, parseFunnelDefinition } from "@/lib/funnels/schema";
import { applyBlockPatches, assertSlugAvailable, FunnelError, funnelStats7d } from "@/lib/funnels/service";
import type { FunnelDefinition } from "@/lib/funnels/types";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const row = await findFunnel(id, auth.context.workspaceId);
  if (!row) return fail("Funnel not found", 404);
  const stats = await funnelStats7d([row.id]);
  return ok(presentFunnelDetail(row, stats.get(row.id)));
}

// Only name, address and the DRAFT. status / published are refused (strict):
// what is live only changes with "Publicar", by a human.
const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_FUNNEL_NAME).optional(),
    slug: z.string().trim().min(1).max(80).optional(),
    draft: z.unknown().optional(),
    patches: z
      .array(
        z
          .object({
            stepId: z.string().min(1).max(40),
            blockId: z.string().min(1).max(40).optional(),
            set: z.record(z.string(), z.unknown()),
          })
          .strict()
      )
      .max(100)
      .optional(),
  })
  .strict();

export async function PATCH(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const row = await findFunnel(id, auth.context.workspaceId);
  if (!row) return fail("Funnel not found", 404);

  const body = await readFunnelJson(request);
  if (body === TOO_LARGE) return fail("Too large", 413, { code: "too_large" });
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return liveKeyError(parsed.error)
      ? fail("Publish, unpublish and archive with their own buttons", 400, { code: "draft_only" })
      : fail("Invalid funnel", 400, { code: "invalid_funnel", issues: parsed.error.issues });
  }
  const data: Prisma.FunnelUpdateInput = {};
  if (parsed.data.name !== undefined) data.name = parsed.data.name;

  if (parsed.data.slug !== undefined && parsed.data.slug !== row.slug) {
    // The address of a live funnel only moves after unpublishing (links out there would break).
    if (row.status === "PUBLISHED") {
      return fail("Unpublish the quiz before changing its address", 409, { code: "published" });
    }
    try {
      await assertSlugAvailable(parsed.data.slug, row.id);
    } catch (error) {
      if (error instanceof FunnelError) return fail(error.message, error.status, { code: error.code });
      throw error;
    }
    data.slug = parsed.data.slug;
  }

  let definition: FunnelDefinition | null = null;
  if (parsed.data.draft !== undefined) {
    const def = parseFunnelDefinition(parsed.data.draft);
    if (!def.ok) return fail("Invalid funnel definition", 400, { code: "invalid_funnel", issues: def.issues });
    definition = def.definition;
  }
  if (parsed.data.patches && parsed.data.patches.length > 0) {
    const current = definition ?? definitionOrNull(row.draft);
    if (!current) return fail("The saved draft is invalid; send the whole draft", 400, { code: "invalid_funnel" });
    const patched = applyBlockPatches(current, parsed.data.patches);
    if (!patched.ok) return fail(patched.message, 400, { code: "invalid_funnel", issues: patched.issues ?? [] });
    definition = patched.definition;
  }
  if (definition) data.draft = definition as unknown as Prisma.InputJsonValue;
  if (Object.keys(data).length === 0) return fail("Nothing to change", 400);

  try {
    const updated = await prisma.funnel.update({ where: { id: row.id }, data, select: FUNNEL_SELECT });
    const stats = await funnelStats7d([row.id]);
    return ok(presentFunnelDetail(updated, stats.get(row.id)));
  } catch (error) {
    if ((error as { code?: string } | null)?.code === "P2002") {
      return fail("This address is already in use", 409, { code: "slug_taken" });
    }
    throw error;
  }
}

// Deleting is a human decision and only for a funnel that is not live.
export async function DELETE(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("delete quizzes");
  if (blocked) return blocked;
  const { id } = await params;
  const row = await findFunnel(id, auth.context.workspaceId);
  if (!row) return fail("Funnel not found", 404);
  if (row.status === "PUBLISHED") return fail("Unpublish the quiz before deleting it", 409, { code: "published" });
  await prisma.funnel.delete({ where: { id: row.id } });
  return ok({ id: row.id, deleted: true });
}
