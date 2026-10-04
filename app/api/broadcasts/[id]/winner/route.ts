import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { humanOnly } from "@/lib/segments/api";
import { VARIANT_KEYS } from "@/lib/ab/keys";
import { parseVariants } from "@/lib/broadcasts/schema";
import { findBroadcast, presentBroadcast } from "@/lib/broadcasts/service";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

const bodySchema = z.object({ key: z.enum(VARIANT_KEYS) });

// "Declare the winner": the winning text becomes the broadcast's only text
// (whoever is still pending gets it). Human only.
export async function POST(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("declare A/B winners");
  if (blocked) return blocked;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Send { key: A | B | C }", 400, parsed.error.issues);
  const { id } = await params;
  const broadcast = await findBroadcast(id, auth.context.workspaceId);
  if (!broadcast) return fail("Broadcast not found", 404);
  const winner = parseVariants(broadcast.variants).find((v) => v.key === parsed.data.key);
  if (!winner) return fail("This broadcast has no such variant", 404, { code: "no_variant" });
  await prisma.broadcast.update({
    where: { id: broadcast.id },
    data: { abWinnerKey: winner.key, text: winner.text },
  });
  const updated = await findBroadcast(id, auth.context.workspaceId);
  return ok(updated ? presentBroadcast(updated) : null);
}
