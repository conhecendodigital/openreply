/**
 * 28/10/2026: publicar, ligar e desligar FLUXO e ligar/desligar CAMPANHA pela chave (MCP), a pedido
 * do dono ("quando eu pedir, tem que fazer"). Mesma regra de domínio da tela (publishFlowChecked,
 * setFlowActive em lib/flows/service.ts). Travas contra BUG, não contra o dono: só age em item existente
 * do workspace da chave, publica só se a validação passar, nunca apaga, repetir não duplica, ligar
 * detecta quem já responde ao mesmo gatilho (DM duplicada), cada ação vira OperationalEvent sem conteúdo
 * e a resposta é lida do banco depois. Interruptor de emergência: MCP_FLUXOS_DISABLED=1.
 */
import { NextRequest } from "next/server";
import { fail, ok, readJson, requireContext } from "@/lib/api-helpers";
import { getApiCaller } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { findFlow } from "@/lib/flows/api";
import { automationHandlers, findActiveConflicts, flowHandlers, type Conflict } from "@/lib/flows/conflicts";
import { definitionOrNull, presentFlowSummary, publishFlowChecked, setFlowActive, triggerColumns } from "@/lib/flows/service";

export const MCP_FLUXOS_OFF_MESSAGE =
  "Publicar e ligar pelo MCP está desligado neste servidor (MCP_FLUXOS_DISABLED=1). Faça pela tela do Lead Engine.";
const DUP_WARNING =
  "Dois itens ligados no mesmo gatilho (mesmo post e palavras) mandam DM duplicada. Repita com desligarConflitantes:true para desligar (nunca apagar) os da lista e ligar este.";

type Gate = { context: { workspaceId: string; userId: string }; tokenId: string };

async function gate(): Promise<{ response: Response } | Gate> {
  if (process.env.MCP_FLUXOS_DISABLED === "1") return { response: fail(MCP_FLUXOS_OFF_MESSAGE, 503, { code: "mcp_fluxos_disabled" }) };
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return { response: auth.response };
  const caller = await getApiCaller();
  if (caller.kind !== "token" || !caller.tokenId) {
    return { response: fail("This route is for the MCP only. In the app, use the Flows/Campaigns screens.", 403, { code: "api_key_only" }) };
  }
  return { context: auth.context, tokenId: caller.tokenId };
}

async function audit(g: Gate, action: string, tipo: "fluxo" | "campanha", id: string, extra: Record<string, unknown> = {}) {
  try {
    await prisma.operationalEvent.create({
      data: {
        workspaceId: g.context.workspaceId,
        source: "SYSTEM",
        level: "INFO",
        message: `MCP: ${action}`,
        payload: { tokenId: g.tokenId, userId: g.context.userId, tipo, itemId: id, ...extra },
      },
    });
    return true;
  } catch {
    return false;
  }
}

type FlowRowT = NonNullable<Awaited<ReturnType<typeof findFlow>>>;

function flowResumo(flow: FlowRowT, conferencia: "CONFERE" | "NÃO CONFERE", extra: Record<string, unknown> = {}) {
  const s = presentFlowSummary(flow);
  return {
    conferencia,
    tipo: "fluxo",
    id: s.id,
    nome: s.name,
    publicado: s.published,
    versao: s.publishedVersion,
    ligado: s.isActive,
    temMudancasNaoPublicadas: s.hasUnpublishedChanges,
    gatilho: s.trigger,
    ...extra,
  };
}

async function liveFlowHandlers(flow: FlowRowT) {
  const live = definitionOrNull(flow.published);
  return live ? flowHandlers(triggerColumns(live.trigger)) : [];
}

/** Desliga (nunca apaga) cada conflitante, registrando um evento por item. false se a auditoria falhar. */
async function turnOffConflicts(g: Gate, conflicts: Conflict[], porQuem: { tipo: string; id: string }) {
  for (const c of conflicts) {
    if (!(await audit(g, `${c.tipo} desligado (conflito de gatilho)`, c.tipo, c.id, { motivo: "desligarConflitantes", noLugarDe: porQuem }))) return false;
    if (c.tipo === "fluxo") await prisma.flow.update({ where: { id: c.id }, data: { isActive: false } });
    else await prisma.automation.update({ where: { id: c.id }, data: { isActive: false } });
  }
  return true;
}

export async function mcpFlowPublish(id: string) {
  const g = await gate();
  if ("response" in g) return g.response;
  const flow = await findFlow(id, g.context.workspaceId);
  if (!flow) return fail("Flow not found", 404);
  const check = await publishFlowChecked({ flow: { ...flow, workspaceId: g.context.workspaceId }, userId: g.context.userId, skipIfUnchanged: true });
  if (!check.ok) {
    return fail(`${check.message}. Nada foi publicado.`, check.status, { oQueFalta: check.details });
  }
  if (check.unchanged) {
    return ok(flowResumo(flow, "CONFERE", { aviso: "Sem mudanças desde a última publicação. Nada foi alterado." }));
  }
  // publishFlowChecked já gravou; a auditoria entra logo depois (o item é o mesmo).
  const audited = await audit(g, "fluxo publicado", "fluxo", id, { versao: check.version });
  const stored = await findFlow(id, g.context.workspaceId);
  const matches = Boolean(stored && stored.published && stored.publishedVersion === check.version && !presentFlowSummary(stored).hasUnpublishedChanges);
  return ok(
    flowResumo(stored ?? flow, matches ? "CONFERE" : "NÃO CONFERE", {
      avisos: check.warnings,
      ...(audited ? {} : { aviso: "Publicou, mas não conseguiu registrar a auditoria." }),
    })
  );
}

export async function mcpFlowToggle(request: NextRequest, id: string, on: boolean) {
  const g = await gate();
  if ("response" in g) return g.response;
  const body = (await readJson(request).catch(() => null)) as { desligarConflitantes?: unknown } | null;
  const desligar = body?.desligarConflitantes === true;
  const flow = await findFlow(id, g.context.workspaceId);
  if (!flow) return fail("Flow not found", 404);
  if (flow.isActive === on) return ok(flowResumo(flow, "CONFERE", { aviso: on ? "Já estava ligado. Nada foi alterado." : "Já estava desligado. Nada foi alterado." }));

  let desligados: Conflict[] = [];
  if (on) {
    if (!flow.published || !flow.triggerType) {
      return fail("Publique o fluxo antes de ligar (publicar_fluxo).", 409, { code: "not_published" });
    }
    const conflicts = await findActiveConflicts({
      instagramAccountId: flow.instagramAccountId,
      handlers: await liveFlowHandlers(flow),
      self: { tipo: "fluxo", id: flow.id },
    });
    if (conflicts.length > 0) {
      if (!desligar) {
        return fail("Já existe item ligado no mesmo gatilho. Nada foi ligado.", 409, { code: "gatilho_duplicado", conflitantes: conflicts, aviso: DUP_WARNING });
      }
      if (!(await turnOffConflicts(g, conflicts, { tipo: "fluxo", id: flow.id }))) return fail("Could not record the action. Try again.", 500, { code: "audit_failed" });
      desligados = conflicts;
    }
  }
  if (!(await audit(g, on ? "fluxo ligado" : "fluxo desligado", "fluxo", id))) return fail("Could not record the action. Try again.", 500, { code: "audit_failed" });
  const result = await setFlowActive(flow, on);
  if (!result.ok) return fail(result.message, result.status, { code: result.code });
  const stored = await findFlow(id, g.context.workspaceId);
  let matches = Boolean(stored && stored.isActive === on);
  if (on && desligar && stored) {
    const still = await findActiveConflicts({ instagramAccountId: stored.instagramAccountId, handlers: await liveFlowHandlers(stored), self: { tipo: "fluxo", id } });
    if (still.length > 0) matches = false;
  }
  return ok(flowResumo(stored ?? result.updated, matches ? "CONFERE" : "NÃO CONFERE", desligados.length ? { desligadosPorConflito: desligados } : {}));
}

export async function mcpCampaignToggle(request: NextRequest, id: string, on: boolean) {
  const g = await gate();
  if ("response" in g) return g.response;
  const body = (await readJson(request).catch(() => null)) as { desligarConflitantes?: unknown } | null;
  const desligar = body?.desligarConflitantes === true;
  const auto = await prisma.automation.findFirst({ where: { id, workspaceId: g.context.workspaceId } });
  if (!auto) return fail("Campaign not found", 404);
  const resumo = (a: typeof auto, conferencia: "CONFERE" | "NÃO CONFERE", extra: Record<string, unknown> = {}) => ({
    conferencia,
    tipo: "campanha",
    id: a.id,
    nome: a.name,
    ligada: a.isActive,
    gatilho: a.trigger,
    palavras: a.matchAnyWord ? "qualquer palavra" : a.keywords,
    ...extra,
  });
  if (auto.isActive === on) return ok(resumo(auto, "CONFERE", { aviso: on ? "Já estava ligada. Nada foi alterado." : "Já estava desligada. Nada foi alterado." }));

  let desligados: Conflict[] = [];
  if (on) {
    const conflicts = await findActiveConflicts({
      instagramAccountId: auto.instagramAccountId,
      handlers: automationHandlers(auto),
      self: { tipo: "campanha", id: auto.id },
    });
    if (conflicts.length > 0) {
      if (!desligar) {
        return fail("Já existe item ligado no mesmo gatilho. Nada foi ligado.", 409, { code: "gatilho_duplicado", conflitantes: conflicts, aviso: DUP_WARNING });
      }
      if (!(await turnOffConflicts(g, conflicts, { tipo: "campanha", id: auto.id }))) return fail("Could not record the action. Try again.", 500, { code: "audit_failed" });
      desligados = conflicts;
    }
  }
  if (!(await audit(g, on ? "campanha ligada" : "campanha desligada", "campanha", id))) return fail("Could not record the action. Try again.", 500, { code: "audit_failed" });
  await prisma.automation.update({ where: { id }, data: { isActive: on } });
  const stored = await prisma.automation.findFirst({ where: { id, workspaceId: g.context.workspaceId } });
  let matches = Boolean(stored && stored.isActive === on);
  if (on && desligar && stored) {
    const still = await findActiveConflicts({ instagramAccountId: stored.instagramAccountId, handlers: automationHandlers(stored), self: { tipo: "campanha", id } });
    if (still.length > 0) matches = false;
  }
  return ok(resumo(stored ?? auto, matches ? "CONFERE" : "NÃO CONFERE", desligados.length ? { desligadosPorConflito: desligados } : {}));
}
