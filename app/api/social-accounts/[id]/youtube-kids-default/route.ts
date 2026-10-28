import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { prisma } from "@/lib/db/client";
import { humanOnly } from "@/lib/flows/api";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

const bodySchema = z.object({ enabled: z.boolean() }).strict();

/**
 * Padrão do canal do YouTube: "meus vídeos NÃO são para crianças".
 * É uma declaração do DONO ao YouTube, por isso só pessoa logada na tela liga ou desliga
 * (chave de API e MCP recebem 403 human_only). Cada mudança fica no registro (quem e quando, sem dado sensível).
 */
export async function PUT(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("change the YouTube kids default");
  if (blocked) return blocked;

  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return fail("Invalid body", 400, { code: "invalid_body", issues: parsed.error.issues });
  const { enabled } = parsed.data;

  const { id } = await params;
  const account = await prisma.socialAccount.findFirst({
    where: { id, workspaceId: auth.context.workspaceId, platform: "YOUTUBE", status: { not: "DISCONNECTED" } },
    select: { id: true },
  });
  if (!account) return fail("YouTube channel not found", 404);

  const now = new Date();
  await prisma.socialAccount.update({
    where: { id },
    data: { youtubeNotForKidsDefault: enabled, youtubeNotForKidsDefaultAt: now, youtubeNotForKidsDefaultBy: auth.context.userId },
  });
  try {
    await prisma.operationalEvent.create({
      data: {
        workspaceId: auth.context.workspaceId,
        source: "SYSTEM",
        level: "INFO",
        message: enabled ? "YouTube: owner turned ON the 'not made for kids' default" : "YouTube: owner turned OFF the 'not made for kids' default",
        payload: { socialAccountId: id, userId: auth.context.userId, enabled, at: now.toISOString() },
      },
    });
  } catch {
    // O registro é auditoria: não derruba a mudança.
  }
  return ok({ id, enabled, at: now.toISOString() });
}
