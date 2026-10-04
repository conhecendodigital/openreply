import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { getApiCaller } from "@/lib/auth";
import { VARIANT_KEYS, validateWeights } from "@/lib/ab/keys";
import {
  activeVariants,
  campaignVariantStats,
  findAbAutomation,
  saveCampaignVariants,
} from "@/lib/ab/campaign";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

const MAX_TEXT = 1000;

// The campaign's A/B: on/off, the variants (null text = the campaign's own)
// and per variant: people who got it, clicked, replied, CTR.
export async function GET(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const automation = await findAbAutomation(id, auth.context.workspaceId);
  if (!automation) return fail("Campaign not found", 404);
  const [variants, stats] = await Promise.all([activeVariants(automation.id), campaignVariantStats(automation.id)]);
  return ok({
    automationId: automation.id,
    abTestEnabled: automation.abTestEnabled,
    abWinnerKey: automation.abWinnerKey,
    base: { openingDmEnabled: automation.openingDmEnabled, openingDmMessage: automation.openingDmMessage, dmMessage: automation.dmMessage },
    variants,
    stats,
  });
}

const variantSchema = z.object({
  key: z.enum(VARIANT_KEYS),
  weight: z.number().int().min(1).max(99),
  openingDmMessage: z.string().max(MAX_TEXT).optional().nullable(),
  dmMessage: z.string().max(MAX_TEXT).optional().nullable(),
});
const putSchema = z.object({ variants: z.array(variantSchema).min(2).max(VARIANT_KEYS.length) }).strict();

// Save the variants (does NOT turn the test on). While a test is running only
// a signed-in human may change its texts or split; an API key may prepare
// them while it is off.
export async function PUT(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const parsed = putSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Invalid variants", 400, parsed.error.issues);
  const weightError = validateWeights(parsed.data.variants);
  if (weightError) return fail(weightError, 400, { code: "weights" });
  if (parsed.data.variants.every((v) => !v.dmMessage?.trim() && !v.openingDmMessage?.trim())) {
    return fail("At least one variant must change a text", 400, { code: "no_change" });
  }
  const { id } = await params;
  const automation = await findAbAutomation(id, auth.context.workspaceId);
  if (!automation) return fail("Campaign not found", 404);
  if (automation.abTestEnabled && (await getApiCaller()).kind === "token") {
    return fail("API keys cannot change a running A/B test. Do it in the Lead Engine.", 403, { code: "human_only" });
  }
  await saveCampaignVariants(automation, parsed.data.variants, auth.context.userId);
  return ok({ automationId: automation.id, abTestEnabled: automation.abTestEnabled, variants: await activeVariants(automation.id) });
}
