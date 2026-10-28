import { NextRequest } from "next/server";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { getApiCaller } from "@/lib/auth";
import { controlResgate, listResgates, planResgate, resgateReport } from "@/lib/resgate/service";

export const dynamic = "force-dynamic";
// Ler os comentários de um Reel grande leva minutos (50 por página).
export const maxDuration = 300;

const str = (v: unknown, max = 500) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Resgatar comentários: dono ou admin do workspace (tela ou chave de API). */
export async function POST(request: NextRequest) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const body = (await readJson(request)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return fail("Corpo inválido.", 400);

  const acao = str(body.acao, 20);
  if (acao) {
    const id = str(body.execucaoId, 100);
    if (!id || !["pausar", "retomar", "cancelar"].includes(acao)) return fail("acao precisa ser pausar, retomar ou cancelar, com execucaoId.", 400);
    const res = await controlResgate(auth.context.workspaceId, id, acao as "pausar" | "retomar" | "cancelar");
    return res.ok ? ok(res.report) : fail(res.error, res.status);
  }

  const caller = await getApiCaller().catch(() => null);
  const extras = Array.isArray(body.palavrasExtras) ? body.palavrasExtras.filter((w): w is string => typeof w === "string").slice(0, 50) : undefined;
  const result = await planResgate({
    workspaceId: auth.context.workspaceId,
    createdBy: caller?.kind === "token" ? `mcp:${caller.tokenId}` : auth.context.userId,
    post: str(body.post),
    flowId: str(body.fluxoId, 100),
    automationId: str(body.automacaoId, 100),
    // Padrão SEGURO: sem dryRun=false explícito, só conta.
    dryRun: body.dryRun !== false,
    limite: num(body.limite) ?? null,
    desde: str(body.desde, 40),
    palavrasExtras: extras,
    tolerarGrafia: body.tolerarGrafia === true,
    intervaloMinSegundos: num(body.intervaloMinSegundos),
    intervaloMaxSegundos: num(body.intervaloMaxSegundos),
    tetoPorHora: num(body.tetoPorHora),
  });
  if (!result.ok) return fail(result.error, result.status, result.code ? { code: result.code } : undefined);
  const { ok: _ok, ...data } = result;
  void _ok;
  return ok(data);
}

/** ?execucaoId=... -> andamento lido do banco; sem parâmetro -> últimas execuções. */
export async function GET(request: NextRequest) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const id = request.nextUrl.searchParams.get("execucaoId");
  if (!id) return ok(await listResgates(auth.context.workspaceId));
  const report = await resgateReport(auth.context.workspaceId, id);
  return report ? ok(report) : fail("Execução não encontrada.", 404);
}
