import { fail, ok, requireContext } from "@/lib/api-helpers";
import { prisma } from "@/lib/db/client";
import { socialAccountDto } from "@/lib/tiktok/dto";

export const dynamic = "force-dynamic";

/** 23/10/2026: contas de redes sociais conectadas pra postar (TikTok). Nunca devolve token. */
export async function GET() {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const rows = await prisma.socialAccount.findMany({
    where: { workspaceId: auth.context.workspaceId, status: { not: "DISCONNECTED" } },
    orderBy: { connectedAt: "desc" },
  });
  if (!rows) return fail("Could not load accounts", 500);
  return ok(rows.map(socialAccountDto));
}
