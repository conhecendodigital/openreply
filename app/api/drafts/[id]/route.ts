import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { editDraft, MAX_DRAFT_REASON, MAX_DRAFT_TEXT } from "@/lib/drafts/drafts";
import { CONTEXT_CONTACT_SELECT, presentContact } from "@/lib/inbox/context";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const draft = await prisma.draftReply.findFirst({
    where: { id, workspaceId: auth.context.workspaceId },
    include: { contact: { select: CONTEXT_CONTACT_SELECT } },
  });
  if (!draft) return fail("Draft not found", 404);
  const { contact, ...rest } = draft;
  return ok({ ...rest, contact: await presentContact(contact, { messages: 10 }) });
}

const patchSchema = z.object({
  text: z.string().min(1).max(MAX_DRAFT_TEXT).optional(),
  reason: z.string().max(MAX_DRAFT_REASON).nullable().optional(),
});

// Edit a PENDING draft's text (or reason). Never sends.
export async function PATCH(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const parsed = patchSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Invalid request", 400, parsed.error.issues);
  if (parsed.data.text === undefined && parsed.data.reason === undefined) return fail("Nothing to change", 400);

  const result = await editDraft({
    workspaceId: auth.context.workspaceId,
    id,
    text: parsed.data.text,
    reason: parsed.data.reason,
  });
  if (!result.ok) return fail(result.error, result.status, { code: result.code });
  return ok({ id, edited: true });
}
