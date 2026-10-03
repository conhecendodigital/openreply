import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import {
  DEFAULT_MODERATION_SETTINGS,
  evaluateComment,
} from "@/lib/moderation/moderate";
import { findAllowedTerm } from "@/lib/moderation/rules";

export const dynamic = "force-dynamic";

const schema = z.object({
  text: z.string().min(1).max(2200),
  instagramAccountId: z.string().min(1).optional().nullable(),
  /** Also ask Jev (only if the key exists and the account turned it on). */
  useJev: z.boolean().optional(),
});

// Dry run of the moderation rules on a sample comment. Writes nothing and
// never touches Instagram.
export async function POST(request: NextRequest) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;

  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Invalid request", 400, parsed.error.issues);

  const account = await getWorkspaceInstagramAccount(
    auth.context.workspaceId,
    parsed.data.instagramAccountId
  );
  const stored = account
    ? await prisma.moderationSettings.findUnique({ where: { instagramAccountId: account.id } })
    : null;
  const settings = stored ?? DEFAULT_MODERATION_SETTINGS;

  const allowedTerm = findAllowedTerm(parsed.data.text, settings.allowedTerms);
  const evaluation = await evaluateComment(parsed.data.text, settings, {
    allowJev: parsed.data.useJev !== false && !allowedTerm,
  });
  const flagged = evaluation.verdict !== "ok";

  return ok({
    ...evaluation,
    flagged,
    allowedTerm,
    mode: settings.mode,
    // What the worker would do with this comment right now.
    wouldDo: !flagged
      ? "nothing"
      : allowedTerm
        ? "protected"
        : settings.mode === "HIDE" && evaluation.confident
          ? "hide"
          : settings.mode === "OFF"
            ? "nothing"
            : "record",
  });
}
