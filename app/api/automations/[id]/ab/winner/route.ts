import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { humanOnly } from "@/lib/flows/api";
import { VARIANT_KEYS } from "@/lib/ab/keys";
import { activeVariants, declareCampaignWinner, findAbAutomation } from "@/lib/ab/campaign";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

const bodySchema = z.object({ key: z.enum(VARIANT_KEYS) });

// "Declare the winner": its texts become the campaign's only texts and the
// test goes off (the variants stay as history). Signed-in human only.
export async function POST(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("declare A/B winners");
  if (blocked) return blocked;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Send { key: A | B | C }", 400, parsed.error.issues);
  const { id } = await params;
  const automation = await findAbAutomation(id, auth.context.workspaceId);
  if (!automation) return fail("Campaign not found", 404);
  const winner = (await activeVariants(automation.id)).find((v) => v.key === parsed.data.key);
  if (!winner) return fail("This campaign has no such variant", 404, { code: "no_variant" });
  await declareCampaignWinner(automation, winner);
  return ok({ automationId: automation.id, abTestEnabled: false, abWinnerKey: winner.key });
}
