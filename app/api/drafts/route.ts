import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import type { DraftStatus } from "@/app/generated/prisma/client";
import { fail, intParam, ok, readJson, requireContext } from "@/lib/api-helpers";
import { getApiCaller } from "@/lib/auth";
import { createDraft, DRAFT_ORIGINS, MAX_DRAFT_REASON, MAX_DRAFT_TEXT } from "@/lib/drafts/drafts";
import { CONTEXT_CONTACT_SELECT, presentContact } from "@/lib/inbox/context";
import { isTakeoverActive } from "@/lib/messaging/takeover";

export const dynamic = "force-dynamic";

const STATUSES: DraftStatus[] = ["PENDING", "APPROVED", "SENT", "REJECTED", "EXPIRED", "FAILED"];

// Drafts, newest first, with the person's context (tags, last DMs, window).
// ?status=PENDING (default) | SENT | EXPIRED | REJECTED | FAILED | APPROVED | all
// Optional ?contactId= and ?instagramAccountId= narrow it (contact page, inbox).
// An API key (the vendedor) never sees drafts of people a human took over.
export async function GET(request: NextRequest) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { workspaceId } = auth.context;

  const params = request.nextUrl.searchParams;
  const statusParam = (params.get("status") ?? "PENDING").toUpperCase();
  const status = statusParam === "ALL" ? null : (STATUSES.find((s) => s === statusParam) ?? "PENDING");
  const limit = intParam(params.get("limit"), 30, 1, 100);
  const page = intParam(params.get("page"), 1, 1, 1000);

  const contactId = params.get("contactId");
  const instagramAccountId = params.get("instagramAccountId");
  const where = {
    workspaceId,
    ...(status ? { status } : {}),
    ...(contactId ? { contactId } : {}),
    ...(instagramAccountId && instagramAccountId !== "all" ? { instagramAccountId } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.draftReply.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { contact: { select: CONTEXT_CONTACT_SELECT } },
    }),
    prisma.draftReply.count({ where }),
  ]);

  const caller = await getApiCaller();
  const now = new Date();
  const visible =
    caller.kind === "token" ? rows.filter((d) => d.status !== "PENDING" || !isTakeoverActive(d.contact, now)) : rows;

  const drafts = await Promise.all(
    visible.map(async ({ contact, ...draft }) => ({
      ...draft,
      contact: await presentContact(contact, { messages: 3, now }),
    }))
  );
  return ok({ drafts, total, page, limit, hiddenByTakeover: rows.length - visible.length });
}

const createSchema = z.object({
  contactId: z.string().min(1),
  text: z.string().min(1).max(MAX_DRAFT_TEXT),
  reason: z.string().max(MAX_DRAFT_REASON).optional().nullable(),
  origin: z.enum(DRAFT_ORIGINS).optional(),
  basedOnMid: z.string().max(200).optional().nullable(),
});

// Create a draft. Never sends anything. An API key always creates it as
// origin "vendedor" (the AI), whatever the body says.
export async function POST(request: NextRequest) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { workspaceId, userId } = auth.context;

  const parsed = createSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Invalid draft", 400, parsed.error.issues);

  const caller = await getApiCaller();
  const origin = caller.kind === "token" ? "vendedor" : (parsed.data.origin ?? "manual");
  const result = await createDraft({
    workspaceId,
    contactId: parsed.data.contactId,
    text: parsed.data.text,
    reason: parsed.data.reason,
    origin,
    basedOnMid: parsed.data.basedOnMid,
    createdBy: caller.kind === "token" ? `token:${caller.tokenId ?? "?"}` : userId,
  });
  if (!result.ok) return fail(result.error, result.status, { code: result.code, ...result.details });
  return ok({ ...result.draft, sent: false }, 201);
}
