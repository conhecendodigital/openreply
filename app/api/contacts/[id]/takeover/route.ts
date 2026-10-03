import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { getApiCaller } from "@/lib/auth";
import { endTakeover, MAX_TAKEOVER_HOURS, startTakeover } from "@/lib/messaging/takeover";
import { describeTakeover } from "@/lib/inbox/context";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  on: z.boolean(),
  hours: z.number().int().min(1).max(MAX_TAKEOVER_HOURS).optional(),
});

// "Assumir conversa" (on: true) / "Devolver pro robô" (on: false).
export async function POST(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { id } = await params;

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Invalid request", 400, parsed.error.issues);

  const contact = await prisma.contact.findFirst({
    where: { id, workspaceId: auth.context.workspaceId },
    select: { id: true },
  });
  if (!contact) return fail("Contact not found", 404);

  const caller = await getApiCaller();
  const by = caller.kind === "session" ? auth.context.userId : "mcp";

  if (parsed.data.on) {
    const started = await startTakeover({ contactId: contact.id, by, reason: "manual", hours: parsed.data.hours });
    if (!started) return fail("Could not take over the conversation", 500);
  } else {
    // Giving the conversation back lets the robot talk to the person again,
    // so the AI's key cannot do it: only a human (session) or a key carrying
    // the human-only "drafts:approve" scope (the Telegram button).
    if (caller.kind === "token" && !caller.scopes.includes("drafts:approve")) {
      return fail("Only a human can give the conversation back to the robot", 403, { code: "human_only" });
    }
    await endTakeover({ contactId: contact.id, by, why: "manual" });
  }

  const fresh = await prisma.contact.findUnique({
    where: { id: contact.id },
    select: { humanTakeover: true, humanTakeoverUntil: true, humanTakeoverReason: true },
  });
  return ok({ id: contact.id, takeover: fresh ? describeTakeover(fresh) : { active: false, until: null, reason: null } });
}
