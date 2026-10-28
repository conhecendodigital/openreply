import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { humanOnly } from "@/lib/flows/api";
import { DEFAULT_OFFER_FACTS, validarPatch, vendedorDesligadoPorEnv } from "@/lib/vendedor-ig/config";
import { DEFAULT_LICOES } from "@/lib/vendedor-ig/conversa";
import { carregarConfig } from "@/lib/vendedor-ig/dados";
import { resumoDoDia } from "@/lib/vendedor-ig/rodar";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * Modo automático do vendedor numa conta Instagram. LER é aberto a quem está logado; LIGAR, DESLIGAR e editar
 * é só pelo dono na tela (humanOnly: chave de API/MCP leva 403, e a rota nem está na lista das chaves).
 */
export async function GET(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const account = await prisma.instagramAccount.findFirst({ where: { id, workspaceId: auth.context.workspaceId }, select: { id: true } });
  if (!account) return fail("Instagram account not found", 404);
  const config = await carregarConfig(id, auth.context.workspaceId);
  const resumo = await resumoDoDia(id);
  return ok({ config, envDisabled: vendedorDesligadoPorEnv(), defaultOfferFacts: DEFAULT_OFFER_FACTS, defaultLicoes: DEFAULT_LICOES, today: resumo });
}

export async function PUT(request: NextRequest, { params }: RouteProps) {
  const blocked = await humanOnly("turn the automatic seller on or off");
  if (blocked) return blocked;
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const account = await prisma.instagramAccount.findFirst({ where: { id, workspaceId: auth.context.workspaceId }, select: { id: true } });
  if (!account) return fail("Instagram account not found", 404);

  const body = await readJson(request);
  if (!body || typeof body !== "object") return fail("Invalid request", 400);
  const parsed = validarPatch(body as Record<string, unknown>);
  if (!parsed.ok) return fail(parsed.error, 400);
  const patch = parsed.patch;
  const now = new Date();
  const data = { ...patch, ...(patch.enabled !== undefined ? { enabledAt: now, enabledBy: auth.context.userId } : {}) };
  await prisma.vendedorIgConfig.upsert({
    where: { instagramAccountId: id },
    create: { workspaceId: auth.context.workspaceId, instagramAccountId: id, ...data },
    update: data,
  });
  const config = await carregarConfig(id, auth.context.workspaceId);
  return ok({ config, envDisabled: vendedorDesligadoPorEnv() });
}
