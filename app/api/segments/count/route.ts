import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { countSegment, segmentFiltersSchema } from "@/lib/segments/filters";
import { workspaceAccountId } from "@/lib/segments/api";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    instagramAccountId: z.string().min(1).optional().nullable(),
    filters: segmentFiltersSchema.default(segmentFiltersSchema.parse({})),
    skipBusy: z.boolean().optional(),
  })
  .strict();

// Live count while the filters are being built (nothing is saved):
// { total, windowOpen, optedOut, takeover, busy, eligible }. Only `eligible`
// (conversation open, not opted out, no takeover, not mid-flow) would get a
// broadcast right now.
export async function POST(request: NextRequest) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Invalid filters", 400, parsed.error.issues);
  const account = await workspaceAccountId(auth.context.workspaceId, parsed.data.instagramAccountId);
  if (!account.ok) return fail("Account not found", 404);
  const count = await countSegment(
    { workspaceId: auth.context.workspaceId, instagramAccountId: account.id },
    parsed.data.filters,
    { skipBusy: parsed.data.skipBusy }
  );
  return ok(count);
}
