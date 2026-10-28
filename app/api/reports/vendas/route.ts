import { NextRequest } from "next/server";
import { ok, requireContext } from "@/lib/api-helpers";
import { prisma } from "@/lib/db/client";
import { buildSalesReport } from "@/lib/reports/vendas-data";

export const dynamic = "force-dynamic";

// "Vendas por origem" (somente leitura). Dono ou admin do workspace; chave de API pode ler.
// Compras que não casaram com nenhuma visita (sem workspace) só aparecem pro
// admin da plataforma (User.role = ADMIN). Nunca devolve e-mail.
export async function GET(request: NextRequest) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const user = await prisma.user.findUnique({ where: { id: auth.context.userId }, select: { role: true } });
  const params = request.nextUrl.searchParams;
  return ok(
    await buildSalesReport({
      workspaceId: auth.context.workspaceId,
      includeUnattributed: user?.role === "ADMIN",
      days: params.get("days"),
      origem: params.get("origem")?.slice(0, 120) ?? null,
    })
  );
}
