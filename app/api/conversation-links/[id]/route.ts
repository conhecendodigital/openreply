import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { getApiCaller } from "@/lib/auth";
import { humanOnly } from "@/lib/flows/api";
import { normalizeOrigin } from "@/lib/conversation-links/links";
import { LINK_INCLUDE, presentLinks } from "@/lib/conversation-links/present";
import { normalizeTagName } from "@/lib/contacts/record";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  origin: z.string().trim().min(1).max(30).optional(),
  automationId: z.string().min(1).nullable().optional(),
  tagName: z.string().trim().max(60).nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const { workspaceId } = auth.context;
  const { id } = await params;

  const parsed = patchSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Invalid request", 400, parsed.error.issues);
  const input = parsed.data;

  const link = await prisma.conversationLink.findFirst({
    where: { id, workspaceId },
    select: { id: true, instagramAccountId: true, isActive: true },
  });
  if (!link) return fail("Link not found", 404);

  // An API key may turn a link off, never back on (owner's rule: the AI does
  // not start answering people by itself).
  const byApiKey = (await getApiCaller()).kind === "token";
  if (byApiKey && input.isActive === true && link.isActive === false) {
    return fail("API keys cannot turn a link on. Do it in the Lead Engine.", 403, { code: "human_only" });
  }

  if (input.automationId) {
    const automation = await prisma.automation.findFirst({
      where: { id: input.automationId, workspaceId, instagramAccountId: link.instagramAccountId },
      select: { id: true, isActive: true },
    });
    if (!automation) return fail("Campaign not found on this account", 404);
    if (byApiKey && automation.isActive) {
      return fail("Turn the campaign off before linking it with an API key", 409, { code: "campaign_on" });
    }
  }
  const origin = input.origin !== undefined ? normalizeOrigin(input.origin) : undefined;
  if (origin === "") return fail("Invalid origin", 400);

  const updated = await prisma.conversationLink.update({
    where: { id: link.id },
    data: {
      ...(origin ? { origin } : {}),
      ...(input.automationId !== undefined ? { automationId: input.automationId } : {}),
      ...(input.tagName !== undefined ? { tagName: input.tagName ? normalizeTagName(input.tagName) || null : null } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
    include: LINK_INCLUDE,
  });
  const [presented] = await presentLinks([updated]);
  return ok(presented);
}

export async function DELETE(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("delete links");
  if (blocked) return blocked;
  const { id } = await params;
  const { count } = await prisma.conversationLink.deleteMany({ where: { id, workspaceId: auth.context.workspaceId } });
  if (count === 0) return fail("Link not found", 404);
  return ok({ id, deleted: true });
}
