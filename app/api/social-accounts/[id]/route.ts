import { fail, ok, requireContext } from "@/lib/api-helpers";
import { prisma } from "@/lib/db/client";
import { humanOnly } from "@/lib/flows/api";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/** Desconecta a conta (TikTok ou YouTube): apaga os tokens e cancela o que estava agendado nela. Só pessoa logada. */
export async function DELETE(_request: Request, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("disconnect accounts");
  if (blocked) return blocked;

  const { id } = await params;
  const account = await prisma.socialAccount.findFirst({ where: { id, workspaceId: auth.context.workspaceId }, select: { id: true, platform: true } });
  if (!account) {
    // Instagram e Facebook são canais: desconectam em Canais (isso também cuida das automações).
    const channel = await prisma.instagramAccount.findFirst({ where: { id, workspaceId: auth.context.workspaceId }, select: { id: true } });
    if (channel) return fail("Instagram and Facebook accounts are disconnected in Channels", 400, { code: "use_channels" });
    return fail("Account not found", 404);
  }
  const label = account.platform === "YOUTUBE" ? "YouTube channel" : "TikTok account";

  await prisma.scheduledPost.updateMany({
    where: { socialAccountId: id, status: "SCHEDULED" },
    data: { status: "DRAFT", scheduledAt: null, lastError: `The ${label} was disconnected` },
  });
  await prisma.socialAccount.update({
    where: { id },
    data: {
      status: "DISCONNECTED",
      accessToken: "",
      refreshToken: null,
      tokenExpiresAt: null,
      refreshExpiresAt: null,
      disconnectedAt: new Date(),
    },
  });
  return ok({ id });
}
