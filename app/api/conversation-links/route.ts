import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { getApiCaller } from "@/lib/auth";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { CODE_PATTERN, normalizeOrigin, randomCode } from "@/lib/conversation-links/links";
import { LINK_INCLUDE, presentLinks } from "@/lib/conversation-links/present";
import { normalizeTagName } from "@/lib/contacts/record";

export const dynamic = "force-dynamic";

// Conversation links (ig.me/m/<user>?ref=<code>) with clicks, opens and people.
export async function GET(request: NextRequest) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const instagramAccountId = request.nextUrl.searchParams.get("instagramAccountId");

  const rows = await prisma.conversationLink.findMany({
    where: {
      workspaceId: auth.context.workspaceId,
      ...(instagramAccountId && instagramAccountId !== "all" ? { instagramAccountId } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: LINK_INCLUDE,
    take: 200,
  });
  return ok({ links: await presentLinks(rows) });
}

const createSchema = z.object({
  code: z.string().regex(CODE_PATTERN, "Use only letters, numbers, - _ = (up to 64)").optional(),
  origin: z.string().trim().min(1).max(30),
  automationId: z.string().min(1).optional().nullable(),
  tagName: z.string().trim().max(60).optional().nullable(),
  instagramAccountId: z.string().min(1).optional().nullable(),
});

export async function POST(request: NextRequest) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const { workspaceId } = auth.context;

  const parsed = createSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Invalid link", 400, parsed.error.issues);
  const input = parsed.data;

  const account = await getWorkspaceInstagramAccount(workspaceId, input.instagramAccountId);
  if (!account) return fail("Instagram account not found", 404);

  const origin = normalizeOrigin(input.origin);
  if (!origin) return fail("Invalid origin", 400);

  if (input.automationId) {
    const automation = await prisma.automation.findFirst({
      where: { id: input.automationId, workspaceId, instagramAccountId: account.id },
      select: { id: true, isActive: true },
    });
    if (!automation) return fail("Campaign not found on this account", 404);
    // A link pointed at a campaign that is ON answers everyone who opens it.
    // An API key may only point a link at a campaign that is off.
    if (automation.isActive && (await getApiCaller()).kind === "token") {
      return fail("Turn the campaign off before linking it with an API key", 409, { code: "campaign_on" });
    }
  }

  const code = input.code ?? randomCode();
  const taken = await prisma.conversationLink.findUnique({ where: { code }, select: { id: true } });
  if (taken) return fail("This code is already in use", 409, { code: "code_taken" });

  const created = await prisma.conversationLink.create({
    data: {
      workspaceId,
      instagramAccountId: account.id,
      code,
      origin,
      automationId: input.automationId ?? null,
      tagName: input.tagName ? normalizeTagName(input.tagName) || null : null,
    },
    include: LINK_INCLUDE,
  });
  const [link] = await presentLinks([created]);
  return ok(link, 201);
}
