import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { readFunnelJson, TOO_LARGE } from "@/lib/funnels/limits";
import { findFunnel, presentFunnelDetail } from "@/lib/funnels/api";
import { MAX_FUNNEL_NAME } from "@/lib/funnels/schema";
import { duplicateFunnel, FunnelError } from "@/lib/funnels/service";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

const bodySchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_FUNNEL_NAME).optional(),
    slug: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

// Copy of the DRAFT, born DRAFT, with no visits (API keys too).
export async function POST(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const source = await findFunnel(id, auth.context.workspaceId);
  if (!source) return fail("Funnel not found", 404);
  const body = await readFunnelJson(request);
  if (body === TOO_LARGE) return fail("Too large", 413, { code: "too_large" });
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) return fail("Invalid body", 400, { code: "invalid_funnel", issues: parsed.error.issues });
  try {
    const row = await duplicateFunnel({
      source,
      userId: auth.context.userId ?? null,
      name: parsed.data.name ?? null,
      slug: parsed.data.slug ?? null,
    });
    return ok(presentFunnelDetail(row), 201);
  } catch (error) {
    if (error instanceof FunnelError) return fail(error.message, error.status, { code: error.code });
    throw error;
  }
}
