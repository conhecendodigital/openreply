import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import {
  cleanTerms,
  DEFAULT_CATEGORIES,
  MAX_TERM_LENGTH,
  MAX_TERMS,
  MODERATION_CATEGORIES,
} from "@/lib/moderation/rules";
import { isJevAvailable } from "@/lib/moderation/jev";

export const dynamic = "force-dynamic";

const termList = z.array(z.string().max(MAX_TERM_LENGTH)).max(MAX_TERMS);

const patchSchema = z.object({
  instagramAccountId: z.string().min(1).optional().nullable(),
  mode: z.enum(["OFF", "OBSERVE", "HIDE"]).optional(),
  categories: z.array(z.enum(MODERATION_CATEGORIES)).max(MODERATION_CATEGORIES.length).optional(),
  blockedTerms: termList.optional(),
  allowedTerms: termList.optional(),
  useJev: z.boolean().optional(),
  jevMinConfidence: z.number().min(0.5).max(1).optional(),
  maxHidesPerHour: z.number().int().min(1).max(500).optional(),
});

async function loadOrCreate(workspaceId: string, instagramAccountId: string) {
  return prisma.moderationSettings.upsert({
    where: { instagramAccountId },
    create: { workspaceId, instagramAccountId, categories: [...DEFAULT_CATEGORIES] },
    update: {},
  });
}

function present(
  settings: Awaited<ReturnType<typeof loadOrCreate>>,
  account: { id: string; username: string }
) {
  return {
    ...settings,
    account: { id: account.id, username: account.username },
    availableCategories: MODERATION_CATEGORIES,
    jevAvailable: isJevAvailable(),
    limits: { maxTerms: MAX_TERMS, maxTermLength: MAX_TERM_LENGTH, maxHidesPerHour: { min: 1, max: 500 } },
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { workspaceId } = auth.context;

  const account = await getWorkspaceInstagramAccount(
    workspaceId,
    request.nextUrl.searchParams.get("instagramAccountId")
  );
  if (!account) return fail("Instagram account not found", 404);

  return ok(present(await loadOrCreate(workspaceId, account.id), account));
}

export async function PATCH(request: NextRequest) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const { workspaceId } = auth.context;

  const parsed = patchSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Invalid settings", 400, parsed.error.issues);
  const input = parsed.data;

  const account = await getWorkspaceInstagramAccount(workspaceId, input.instagramAccountId);
  if (!account) return fail("Instagram account not found", 404);

  await loadOrCreate(workspaceId, account.id);
  const updated = await prisma.moderationSettings.update({
    where: { instagramAccountId: account.id },
    data: {
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.categories ? { categories: [...new Set(input.categories)] } : {}),
      ...(input.blockedTerms ? { blockedTerms: cleanTerms(input.blockedTerms) } : {}),
      ...(input.allowedTerms ? { allowedTerms: cleanTerms(input.allowedTerms) } : {}),
      ...(input.useJev !== undefined ? { useJev: input.useJev } : {}),
      ...(input.jevMinConfidence !== undefined ? { jevMinConfidence: input.jevMinConfidence } : {}),
      ...(input.maxHidesPerHour !== undefined ? { maxHidesPerHour: input.maxHidesPerHour } : {}),
    },
  });

  return ok(present(updated, account));
}
