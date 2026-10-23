import { fail, ok, requireContext } from "@/lib/api-helpers";
import { prisma } from "@/lib/db/client";
import { humanOnly } from "@/lib/flows/api";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/** Desconecta a conta: apaga os tokens e cancela o que estava agendado nela. Só pessoa logada. */
export async function DELETE(_request: Request, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("disconnect accounts");
  if (blocked) return blocked;

  const { id } = await params;
  const account = await prisma.socialAccount.findFirst({ where: { id, workspaceId: auth.context.workspaceId }, select: { id: true } });
  if (!account) return fail("Account not found", 404);

  await prisma.scheduledPost.updateMany({
    where: { socialAccountId: id, status: "SCHEDULED" },
    data: { status: "DRAFT", scheduledAt: null, lastError: "The TikTok account was disconnected" },
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
