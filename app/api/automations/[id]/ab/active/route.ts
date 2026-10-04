import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { humanOnly } from "@/lib/flows/api";
import { validateWeights } from "@/lib/ab/keys";
import { activeVariants, findAbAutomation } from "@/lib/ab/campaign";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

const bodySchema = z.object({ enabled: z.boolean() });

// Turn the campaign's A/B on (signed-in human only, with 2-3 variants adding
// up to 100) or off (anyone who can manage: off = the campaign's own texts,
// exactly as before the test).
export async function POST(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Send { enabled: true | false }", 400, parsed.error.issues);
  if (parsed.data.enabled) {
    const blocked = await humanOnly("turn A/B tests on");
    if (blocked) return blocked;
  }
  const { id } = await params;
  const automation = await findAbAutomation(id, auth.context.workspaceId);
  if (!automation) return fail("Campaign not found", 404);
  if (parsed.data.enabled) {
    const variants = await activeVariants(automation.id);
    const error = validateWeights(variants);
    if (error) return fail(error, 409, { code: "variants" });
  }
  await prisma.automation.update({
    where: { id: automation.id },
    data: { abTestEnabled: parsed.data.enabled, ...(parsed.data.enabled ? { abWinnerKey: null } : {}) },
  });
  return ok({ automationId: automation.id, abTestEnabled: parsed.data.enabled });
}
