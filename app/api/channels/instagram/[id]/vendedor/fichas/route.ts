import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { humanOnly } from "@/lib/flows/api";
import { aplicarEdicaoDoDono, ehEstagio, estagioEfetivo, lerFicha, CAMPOS_TEXTO, type EdicaoDoDono, type NomeCampo } from "@/lib/vendedor-ig/ficha";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

async function conta(id: string, workspaceId: string) {
  return prisma.instagramAccount.findFirst({ where: { id, workspaceId }, select: { id: true } });
}

/** Fichas dos leads da conta (as mais recentes), com a origem de cada campo. */
export async function GET(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!(await conta(id, auth.context.workspaceId))) return fail("Instagram account not found", 404);
  const rows = await prisma.vendedorIgFicha.findMany({ where: { instagramAccountId: id, workspaceId: auth.context.workspaceId }, orderBy: { updatedAt: "desc" }, take: 30 });
  const contatos = await prisma.contact.findMany({
    where: { id: { in: rows.map((r) => r.contactId) } },
    select: { id: true, name: true, username: true, lastInboundAt: true },
  });
  const porId = new Map(contatos.map((c) => [c.id, c]));
  const now = new Date();
  const fichas = rows.map((r) => {
    const f = lerFicha(r.campos, r.estagio);
    const c = porId.get(r.contactId);
    return { contactId: r.contactId, nome: c?.name ?? null, username: c?.username ?? null, estagio: estagioEfetivo(f, c?.lastInboundAt ?? null, now), campos: f.campos, atualizadoEm: r.updatedAt };
  });
  return ok({ fichas });
}

/** O dono corrige a ficha: o que ele escreve vira origem "dono" e a IA nunca sobrescreve. */
export async function PUT(request: NextRequest, { params }: RouteProps) {
  const blocked = await humanOnly("edit a lead file");
  if (blocked) return blocked;
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!(await conta(id, auth.context.workspaceId))) return fail("Instagram account not found", 404);
  const body = (await readJson(request)) as { contactId?: unknown; campos?: unknown; estagio?: unknown } | null;
  if (!body || typeof body.contactId !== "string") return fail("Invalid request", 400);
  const contato = await prisma.contact.findFirst({ where: { id: body.contactId, instagramAccountId: id, workspaceId: auth.context.workspaceId }, select: { id: true } });
  if (!contato) return fail("Contact not found", 404);
  const edicao: EdicaoDoDono = {};
  if (body.estagio !== undefined) {
    if (!ehEstagio(body.estagio)) return fail("Invalid stage", 400);
    edicao.estagio = body.estagio;
  }
  if (body.campos !== undefined) {
    if (!body.campos || typeof body.campos !== "object" || Array.isArray(body.campos)) return fail("Invalid fields", 400);
    edicao.campos = {};
    for (const [k, v] of Object.entries(body.campos as Record<string, unknown>)) {
      if (!([...CAMPOS_TEXTO, "seguidores"] as string[]).includes(k)) return fail(`Unknown field: ${k}`, 400);
      if (v !== null && typeof v !== "string") return fail(`${k}: text or null`, 400);
      edicao.campos[k as NomeCampo] = v as string | null;
    }
  }
  const row = await prisma.vendedorIgFicha.findUnique({ where: { contactId: contato.id } });
  const nova = aplicarEdicaoDoDono(lerFicha(row?.campos, row?.estagio), edicao, new Date());
  const data = { campos: nova.campos as object, estagio: nova.estagio };
  await prisma.vendedorIgFicha.upsert({
    where: { contactId: contato.id },
    create: { contactId: contato.id, workspaceId: auth.context.workspaceId, instagramAccountId: id, ...data },
    update: data,
  });
  return ok({ contactId: contato.id, estagio: nova.estagio, campos: nova.campos });
}
