/**
 * O que as telas leem e gravam das regras, da ficha e do CRM de leads
 * (WhatsApp > Leads, ficha na conversa, "O que o agente aprendeu", "Testar o
 * agente"). Só no servidor, sempre com a RLS do workspace (withRls).
 *
 * Regra dura só muda aqui por duas portas, e as duas são clique do dono:
 * Salvar na tela Agentes (lib/whatsapp/painel.ts saveAgents) ou Aceitar uma
 * sugestão (decideSuggestion). Nada que a IA devolve muda regra sozinho.
 */
import type { Prisma } from "@/app/generated/prisma/client";
import type { AgentProfile, SentBy, WaMessageLite } from "@/lib/whatsapp/agentes/types";
import { gravarEstagio } from "@/lib/whatsapp/agentes/store-prisma";
import { custoMaximoUsdMicro } from "@/lib/whatsapp/agentes/modelos";
import { leadView, loadSession, PainelError, rls, type LeadView, type PainelDeps } from "@/lib/whatsapp/painel";
import { toCsv, type CsvCell } from "@/lib/utils/csv-write";
import { lerRegras, regrasPreenchidas, temRegras } from "./esquema";
import { classificarLead, decidirMudanca, ESTAGIOS, estagioNaTela, estagioValido, lerConfigEstagios, NOME_ESTAGIO, type Estagio, type TipoForaDoPerfil } from "./estagio";
import { camposDaFicha, editarFicha, lerFicha, resumoDaFicha } from "./ficha";
import { blocoRegras } from "./prompt";
import { verificarResposta } from "./verificar";
import {
  acrescentarInstrucao,
  aplicarMudanca,
  chaveDaMudanca,
  lerSugestoesIa,
  MAX_TOKENS_SUGESTOES,
  mensagemSugestoes,
  MudancaSchema,
  SISTEMA_SUGESTOES,
  sugestoesDosCasos,
} from "./sugestoes";
import { testarAgente, type ResultadoTeste } from "./testar";
import type { DepsIa } from "./servidor";

type Ctx = { userId: string; workspaceId: string };
type Tx = Parameters<Parameters<typeof rls>[2]>[0];

const rlsDe = (ctx: Ctx, deps: PainelDeps) => <T>(fn: (tx: Tx) => Promise<T>) => rls(ctx, deps, fn);

/* ------------------------------- conversa: estágio e ficha ------------------------------- */

async function conversaDoLead(tx: Tx, ctx: Ctx, conversationId: string) {
  const c = await tx.waConversation.findFirst({
    where: { id: conversationId, workspaceId: ctx.workspaceId },
    select: {
      id: true,
      sessionId: true,
      leadFicha: true,
      leadStage: true,
      leadStageMotivo: true,
      leadStageManual: true,
      leadStageAt: true,
      contact: { select: { name: true, pushName: true } },
    },
  });
  if (!c) throw new PainelError("not_found", "Conversation not found.", 404);
  return c;
}

async function leadDaConversa(ctx: Ctx, conversationId: string, deps: PainelDeps): Promise<LeadView> {
  return rls(ctx, deps, async (tx) => {
    const c = await conversaDoLead(tx, ctx, conversationId);
    const [profile, history, ultima] = await Promise.all([
      tx.waAgentProfile.findUnique({ where: { sessionId: c.sessionId }, select: { regrasNegocio: true, estagiosLead: true } }),
      tx.waLeadStageEvent.findMany({ where: { conversationId }, orderBy: { createdAt: "desc" }, take: 20 }),
      tx.waMessage.findFirst({ where: { conversationId }, orderBy: { sentAt: "desc" }, select: { fromMe: true, sentAt: true } }),
    ]);
    return leadView(c, profile, history, ultima, new Date());
  });
}

/** O dono muda o estágio na mão: vence o agente e fica marcado como manual. */
export async function setLeadStage(ctx: Ctx, conversationId: string, input: { stage: unknown; reason?: unknown; kind?: unknown }, deps: PainelDeps): Promise<LeadView> {
  if (!estagioValido(input.stage)) throw new PainelError("invalid_stage", "Unknown stage.", 400);
  const stage = input.stage;
  const reason = typeof input.reason === "string" ? input.reason.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  const tipo: TipoForaDoPerfil | null =
    stage === "fora_do_perfil" ? (input.kind === "regiao" || input.kind === "servico" ? input.kind : "outro") : null;
  const c = await rls(ctx, deps, (tx) => conversaDoLead(tx, ctx, conversationId));
  await gravarEstagio(rlsDe(ctx, deps), ctx.workspaceId, {
    conversationId,
    sessionId: c.sessionId,
    de: estagioValido(c.leadStage) ? c.leadStage : null,
    nova: { estagio: stage, motivo: reason || "mudado pela equipe", tipo },
    manual: true,
    porUserId: ctx.userId,
  });
  return leadDaConversa(ctx, conversationId, deps);
}

/** Devolve o estágio pro agente (tira o "manual"); ele recalcula na próxima mensagem. */
export async function releaseLeadStage(ctx: Ctx, conversationId: string, deps: PainelDeps): Promise<LeadView> {
  await rls(ctx, deps, (tx) => tx.waConversation.updateMany({ where: { id: conversationId, workspaceId: ctx.workspaceId }, data: { leadStageManual: false } }));
  return leadDaConversa(ctx, conversationId, deps);
}

/**
 * O dono edita a ficha: vale como confirmado e o agente não sobrescreve. Se o
 * estágio não é manual, ele é recalculado na hora pelas regras.
 */
export async function editLeadFicha(ctx: Ctx, conversationId: string, input: { fields: unknown }, deps: PainelDeps): Promise<LeadView> {
  const fields = input.fields && typeof input.fields === "object" ? (input.fields as Record<string, unknown>) : null;
  if (!fields) throw new PainelError("invalid_fields", "Send the fields to change.", 400);
  const now = new Date();
  const recalculo = await rls(ctx, deps, async (tx) => {
    const c = await conversaDoLead(tx, ctx, conversationId);
    const profile = await tx.waAgentProfile.findUnique({ where: { sessionId: c.sessionId }, select: { regrasNegocio: true } });
    const regras = profile?.regrasNegocio ? lerRegras(profile.regrasNegocio) : null;
    const defs = camposDaFicha(regras);
    const ficha = editarFicha(lerFicha(c.leadFicha), fields, defs, now);
    await tx.waConversation.updateMany({ where: { id: conversationId, workspaceId: ctx.workspaceId }, data: { leadFicha: ficha as unknown as Prisma.InputJsonValue } });
    if (!temRegras(regras) || c.leadStageManual) return null;
    const mensagens = await tx.waMessage.findMany({
      where: { conversationId },
      orderBy: { sentAt: "desc" },
      take: 40,
      select: { id: true, fromMe: true, sentBy: true, type: true, body: true, sentAt: true, mediaText: true, mediaTextKind: true },
    });
    const historico: WaMessageLite[] = mensagens.reverse().map((m) => ({ ...m, sentBy: m.sentBy as SentBy }));
    const nomes = [c.contact.name, c.contact.pushName].filter((n): n is string => Boolean(n));
    const v = verificarResposta({ regras, agente: "qualificacao", historico, saida: { bolhas: [], passarPraHumano: false, qualificado: false, motivo: "" }, ficha, defs, nomesDoContato: nomes });
    const nova = classificarLead({ regras, verificacao: v, agente: "qualificacao", qualificadoPeloModelo: false });
    // Qualificado fica como estava: quem qualifica é a conversa (o agente ou o dono, na mão).
    if (c.leadStage === "qualificado" && nova.estagio === "qualificando") return null;
    const mudanca = decidirMudanca({ estagio: estagioValido(c.leadStage) ? c.leadStage : null, manual: false, motivo: c.leadStageMotivo }, nova, true);
    return mudanca ? { mudanca, sessionId: c.sessionId, de: estagioValido(c.leadStage) ? c.leadStage : null } : null;
  });
  if (recalculo) {
    await gravarEstagio(rlsDe(ctx, deps), ctx.workspaceId, { conversationId, sessionId: recalculo.sessionId, de: recalculo.de, nova: recalculo.mudanca, manual: false, porUserId: null });
  }
  return leadDaConversa(ctx, conversationId, deps);
}

/* ------------------------------------ quadro de leads ------------------------------------ */

export type LeadCard = {
  conversationId: string;
  sessionId: string;
  contact: { name: string | null; pushName: string | null; phoneE164: string | null };
  stage: Estagio;
  reason: string | null;
  manual: boolean;
  summary: string;
  lastMessageAt: string | null;
  stageAt: string | null;
};

export type LeadsBoard = {
  sessions: Array<{ id: string; label: string }>;
  sessionId: string | null;
  columns: Array<{ stage: Estagio; name: string; count: number; cards: LeadCard[] }>;
  total: number;
};

export interface LeadsQuery {
  sessionId?: string | null;
  stage?: string | null;
  from?: string | null;
  to?: string | null;
  q?: string | null;
}

function dataOuNull(s: string | null | undefined, fimDoDia = false): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(`${s.slice(0, 10)}T${fimDoDia ? "23:59:59.999" : "00:00:00.000"}-03:00`);
  return Number.isFinite(d.getTime()) ? d : null;
}

async function linhasDeLeads(ctx: Ctx, query: LeadsQuery, deps: PainelDeps, limite: number) {
  const q = (query.q ?? "").trim().slice(0, 80);
  const de = dataOuNull(query.from);
  const ate = dataOuNull(query.to, true);
  return rls(ctx, deps, async (tx) => {
    const sessions = await tx.waSession.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, phoneE164: true, displayName: true },
    });
    const rows = await tx.waConversation.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        archivedAt: null,
        contact: { isGroup: false },
        ...(query.sessionId ? { sessionId: query.sessionId } : {}),
        ...(de || ate ? { lastMessageAt: { ...(de ? { gte: de } : {}), ...(ate ? { lte: ate } : {}) } } : {}),
        ...(q
          ? {
              OR: [
                { contact: { name: { contains: q, mode: "insensitive" } } },
                { contact: { pushName: { contains: q, mode: "insensitive" } } },
                { contact: { phoneE164: { contains: q.replace(/[^\d+]/g, "") || q } } },
              ],
            }
          : {}),
      },
      orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }],
      take: limite,
      select: {
        id: true,
        sessionId: true,
        lastMessageAt: true,
        leadFicha: true,
        leadStage: true,
        leadStageMotivo: true,
        leadStageManual: true,
        leadStageAt: true,
        contact: { select: { name: true, pushName: true, phoneE164: true } },
        messages: { orderBy: { sentAt: "desc" }, take: 1, select: { fromMe: true, sentAt: true } },
      },
    });
    const profiles = await tx.waAgentProfile.findMany({
      where: { workspaceId: ctx.workspaceId, sessionId: { in: [...new Set(rows.map((r) => r.sessionId)), ...(query.sessionId ? [query.sessionId] : [])] } },
      select: { sessionId: true, regrasNegocio: true, estagiosLead: true },
    });
    return { sessions, rows, profiles };
  });
}

export async function listLeads(ctx: Ctx, query: LeadsQuery, deps: PainelDeps): Promise<LeadsBoard> {
  const now = new Date();
  const { sessions, rows, profiles } = await linhasDeLeads(ctx, query, deps, 500);
  const perfil = (id: string) => profiles.find((p) => p.sessionId === id) ?? null;
  const cfg = lerConfigEstagios(query.sessionId ? (perfil(query.sessionId)?.estagiosLead ?? null) : null);
  const cards: LeadCard[] = rows.map((r) => {
    const p = perfil(r.sessionId);
    const defs = camposDaFicha(p?.regrasNegocio ? lerRegras(p.regrasNegocio) : null);
    const resumo = resumoDaFicha(lerFicha(r.leadFicha), defs).split("\n").filter(Boolean).slice(0, 4).join(" · ");
    return {
      conversationId: r.id,
      sessionId: r.sessionId,
      contact: r.contact,
      stage: estagioNaTela(r.leadStage, r.messages[0] ?? null, now),
      reason: r.leadStageMotivo,
      manual: r.leadStageManual,
      summary: resumo,
      lastMessageAt: r.lastMessageAt?.toISOString() ?? null,
      stageAt: r.leadStageAt?.toISOString() ?? null,
    };
  });
  const filtro = estagioValido(query.stage) ? query.stage : null;
  const columns = ESTAGIOS.filter((e) => !cfg[e].oculto && (!filtro || e === filtro)).map((stage) => {
    const daColuna = cards.filter((c) => c.stage === stage);
    return { stage, name: cfg[stage].nome || NOME_ESTAGIO[stage], count: daColuna.length, cards: daColuna.slice(0, 100) };
  });
  return {
    sessions: sessions.map((s) => ({ id: s.id, label: s.displayName || s.phoneE164 || "WhatsApp" })),
    sessionId: query.sessionId ?? null,
    columns,
    total: columns.reduce((n, c) => n + c.count, 0),
  };
}

/** CSV dos leads (kind=leads) ou do histórico de estágio (kind=history). Sem texto de mensagem. */
export async function exportLeadsCsv(ctx: Ctx, query: LeadsQuery & { kind?: string | null }, deps: PainelDeps): Promise<string> {
  const now = new Date();
  if (query.kind === "history") {
    const de = dataOuNull(query.from);
    const ate = dataOuNull(query.to, true);
    const eventos = await rls(ctx, deps, (tx) =>
      tx.waLeadStageEvent.findMany({
        where: {
          workspaceId: ctx.workspaceId,
          ...(query.sessionId ? { sessionId: query.sessionId } : {}),
          ...(de || ate ? { createdAt: { ...(de ? { gte: de } : {}), ...(ate ? { lte: ate } : {}) } } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 5000,
        select: {
          createdAt: true,
          de: true,
          para: true,
          motivo: true,
          tipo: true,
          manual: true,
          porUserId: true,
          conversation: { select: { contact: { select: { name: true, pushName: true, phoneE164: true } } } },
        },
      })
    );
    const rows: CsvCell[][] = [["date", "contact", "phone", "from", "to", "reason", "kind", "changed_by"]];
    for (const e of eventos) {
      const c = e.conversation.contact;
      rows.push([e.createdAt, c.name || c.pushName, c.phoneE164, e.de, e.para, e.motivo, e.tipo, e.manual ? (e.porUserId ? "team" : "manual") : "agent"]);
    }
    return toCsv(rows);
  }
  const { rows, profiles } = await linhasDeLeads(ctx, query, deps, 5000);
  const header: CsvCell[] = ["contact", "phone", "number", "stage", "reason", "manual", "summary", "last_message_at"];
  const out: CsvCell[][] = [header];
  for (const r of rows) {
    const p = profiles.find((x) => x.sessionId === r.sessionId);
    const defs = camposDaFicha(p?.regrasNegocio ? lerRegras(p.regrasNegocio) : null);
    const stage = estagioNaTela(r.leadStage, r.messages[0] ?? null, now);
    if (estagioValido(query.stage) && stage !== query.stage) continue;
    out.push([r.contact.name || r.contact.pushName, r.contact.phoneE164, r.sessionId, stage, r.leadStageMotivo, r.leadStageManual, resumoDaFicha(lerFicha(r.leadFicha), defs).replace(/\n/g, "; "), r.lastMessageAt]);
  }
  return toCsv(out);
}

/* ------------------------------- "O que o agente aprendeu" ------------------------------- */

export type LearningReport = {
  examples: Array<{ id: string; origin: "edicao" | "assumir"; question: string; answer: string; draft: string | null; createdAt: string }>;
  blocked: { total: number; corrected: number; byRule: Array<{ rule: string; count: number }>; recent: Array<{ rule: string | null; subject: string | null; question: string | null; createdAt: string; corrected: boolean }> };
  discarded: { total: number; recent: Array<{ question: string | null; answer: string | null; createdAt: string }> };
  outside: Array<{ subject: string; people: number }>;
  suggestions: Array<{ id: string; origin: "regra" | "ia"; text: string; createdAt: string }>;
};

export async function getLearning(ctx: Ctx, sessionId: string | null, deps: PainelDeps): Promise<LearningReport> {
  const session = await loadSession(ctx, deps, sessionId ?? "");
  const now = new Date();
  const desde = new Date(now.getTime() - 30 * 86400_000);
  return rls(ctx, deps, async (tx) => {
    const where = { sessionId: session.id, workspaceId: ctx.workspaceId };
    const [exemplos, casos, profile] = await Promise.all([
      tx.waAgentExample.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 }),
      tx.waAgentLearningCase.findMany({ where: { ...where, createdAt: { gte: desde } }, orderBy: { createdAt: "desc" }, take: 500 }),
      tx.waAgentProfile.findUnique({ where: { sessionId: session.id }, select: { regrasNegocio: true } }),
    ]);
    // Sugestões sem IA (contagem): grava as novas como pendentes; recusada não volta.
    const novas = sugestoesDosCasos(casos, profile?.regrasNegocio ?? null, now);
    if (novas.length) {
      await tx.waAgentSuggestion.createMany({
        data: novas.map((n) => ({
          workspaceId: ctx.workspaceId,
          ownerUserId: ctx.userId,
          sessionId: session.id,
          origem: n.origem,
          chave: n.chave,
          texto: n.texto,
          mudanca: n.mudanca as unknown as Prisma.InputJsonValue,
        })),
        skipDuplicates: true,
      });
    }
    const sugestoes = await tx.waAgentSuggestion.findMany({ where: { ...where, status: "pendente" }, orderBy: { createdAt: "desc" }, take: 30 });

    const bloqueios = casos.filter((c) => c.tipo === "regra_bloqueou" || c.tipo === "regra_corrigiu");
    const porRegra = new Map<string, number>();
    for (const b of bloqueios) for (const r of (b.regra ?? "").split(",").filter(Boolean)) porRegra.set(r, (porRegra.get(r) ?? 0) + 1);
    const fora = new Map<string, Set<string>>();
    for (const c of casos) {
      if (c.tipo !== "fora_da_area" || !c.assunto) continue;
      const s = fora.get(c.assunto) ?? new Set<string>();
      s.add(c.conversaHash ?? c.id);
      fora.set(c.assunto, s);
    }
    const descartados = casos.filter((c) => c.tipo === "descartado");
    return {
      examples: exemplos.map((e) => ({
        id: e.id,
        origin: e.origem === "assumir" ? "assumir" : "edicao",
        question: e.pergunta,
        answer: e.resposta,
        draft: e.rascunho,
        createdAt: e.createdAt.toISOString(),
      })),
      blocked: {
        total: bloqueios.length,
        corrected: bloqueios.filter((b) => b.tipo === "regra_corrigiu").length,
        byRule: [...porRegra.entries()].map(([rule, count]) => ({ rule, count })).sort((a, b) => b.count - a.count),
        recent: bloqueios.slice(0, 15).map((b) => ({ rule: b.regra, subject: b.assunto, question: b.pergunta, createdAt: b.createdAt.toISOString(), corrected: b.tipo === "regra_corrigiu" })),
      },
      discarded: { total: descartados.length, recent: descartados.slice(0, 10).map((d) => ({ question: d.pergunta, answer: d.resposta, createdAt: d.createdAt.toISOString() })) },
      outside: [...fora.entries()].map(([subject, s]) => ({ subject, people: s.size })).sort((a, b) => b.people - a.people).slice(0, 10),
      suggestions: sugestoes.map((s) => ({ id: s.id, origin: s.origem === "ia" ? "ia" : "regra", text: s.texto, createdAt: s.createdAt.toISOString() })),
    };
  });
}

export async function removeExample(ctx: Ctx, id: string, deps: PainelDeps): Promise<{ ok: true }> {
  const { count } = await rls(ctx, deps, (tx) => tx.waAgentExample.deleteMany({ where: { id, workspaceId: ctx.workspaceId } }));
  if (!count) throw new PainelError("not_found", "Example not found.", 404);
  return { ok: true };
}

/** Aceitar aplica a mudança (é o clique do dono); recusar só arquiva. */
export async function decideSuggestion(ctx: Ctx, id: string, input: { action: unknown }, deps: PainelDeps): Promise<{ ok: true; applied: boolean }> {
  if (input.action !== "accept" && input.action !== "reject") throw new PainelError("invalid_action", "Unknown action.", 400);
  const aceitar = input.action === "accept";
  return rls(ctx, deps, async (tx) => {
    const s = await tx.waAgentSuggestion.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
    if (!s) throw new PainelError("not_found", "Suggestion not found.", 404);
    if (s.status !== "pendente") throw new PainelError("already_decided", "This suggestion was already handled.", 409);
    let applied = false;
    if (aceitar) {
      const m = MudancaSchema.safeParse(s.mudanca);
      if (!m.success) throw new PainelError("invalid_suggestion", "This suggestion cannot be applied. Reject it and change the rules by hand.", 422);
      if (m.data.acao === "acrescentar_instrucao") {
        const agente = m.data.agente;
        const atual = await tx.waAgentConfig.findUnique({ where: { sessionId_agente: { sessionId: s.sessionId, agente } } });
        const instrucoes = acrescentarInstrucao(atual?.instrucoes, m.data.texto);
        await tx.waAgentConfig.upsert({
          where: { sessionId_agente: { sessionId: s.sessionId, agente } },
          create: { workspaceId: ctx.workspaceId, ownerUserId: ctx.userId, sessionId: s.sessionId, agente, ativo: false, instrucoes },
          update: { instrucoes },
        });
        applied = true;
      } else if (m.data.acao !== "nenhuma") {
        const p = await tx.waAgentProfile.findUnique({ where: { sessionId: s.sessionId }, select: { regrasNegocio: true } });
        const regras = aplicarMudanca(p?.regrasNegocio ?? null, m.data) as unknown as Prisma.InputJsonValue;
        await tx.waAgentProfile.upsert({
          where: { sessionId: s.sessionId },
          create: { workspaceId: ctx.workspaceId, ownerUserId: ctx.userId, sessionId: s.sessionId, regrasNegocio: regras },
          update: { regrasNegocio: regras },
        });
        applied = true;
      }
    }
    await tx.waAgentSuggestion.update({ where: { id }, data: { status: aceitar ? "aceita" : "recusada", decididoPor: ctx.userId, decididoEm: new Date() } });
    return { ok: true as const, applied };
  });
}

/** "Gerar sugestões com IA": lê os casos e os exemplos e grava sugestões PENDENTES. */
export async function generateSuggestionsAi(ctx: Ctx, sessionId: string | null, deps: PainelDeps, ia: DepsIa): Promise<{ created: number }> {
  const session = await loadSession(ctx, deps, sessionId ?? "");
  const dados = await rls(ctx, deps, async (tx) => {
    const where = { sessionId: session.id, workspaceId: ctx.workspaceId };
    const [casos, exemplos, profile] = await Promise.all([
      tx.waAgentLearningCase.findMany({ where, orderBy: { createdAt: "desc" }, take: 40 }),
      tx.waAgentExample.findMany({ where, orderBy: { createdAt: "desc" }, take: 20 }),
      tx.waAgentProfile.findUnique({ where: { sessionId: session.id }, select: { regrasNegocio: true, baseCommand: true } }),
    ]);
    return { casos, exemplos, profile };
  });
  if (!dados.casos.length && !dados.exemplos.length) throw new PainelError("nothing_to_learn", "There is nothing to learn from yet. Come back after some conversations.", 409);
  const { provider, model } = await ia.modelo(true);
  const chave = await ia.chave(provider);
  if (!chave) throw new PainelError("no_ai_key", "There is no AI key in /admin > AI keys yet. Ask the admin to add one.", 409);
  const mensagem = mensagemSugestoes({
    regras: blocoRegras(dados.profile?.regrasNegocio ? lerRegras(dados.profile.regrasNegocio) : null, dados.profile?.baseCommand ?? ""),
    casos: dados.casos,
    exemplos: dados.exemplos,
  });
  const previsto = custoMaximoUsdMicro(model, SISTEMA_SUGESTOES.length + mensagem.length, MAX_TOKENS_SUGESTOES, ia.precos);
  if (!(await ia.conferirTeto(previsto))) {
    await ia.registrarUso({ provider, modelo: model, uso: { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 }, bloqueado: true });
    throw new PainelError("ai_cap", "The daily AI spending cap was reached. Try again tomorrow or ask the admin to raise it in /admin.", 429);
  }
  let texto: string;
  try {
    const r = await ia.chamar({ provider, modelo: model, apiKey: chave, sistemaFixo: SISTEMA_SUGESTOES, sistemaVariavel: "", mensagens: [{ role: "user", content: mensagem }], maxTokens: MAX_TOKENS_SUGESTOES, timeoutMs: 90_000 });
    await ia.registrarUso({ provider, modelo: model, uso: r.uso });
    texto = r.texto;
  } catch {
    throw new PainelError("ai_error", "The AI did not answer now. Try again in a minute.", 502);
  }
  const lista = lerSugestoesIa(texto);
  if (!lista.length) return { created: 0 };
  const r = await rls(ctx, deps, (tx) =>
    tx.waAgentSuggestion.createMany({
      data: lista.map((x) => ({
        workspaceId: ctx.workspaceId,
        ownerUserId: ctx.userId,
        sessionId: session.id,
        origem: "ia",
        chave: chaveDaMudanca(x.mudanca, x.texto),
        texto: x.texto,
        mudanca: x.mudanca as unknown as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    })
  );
  return { created: r.count };
}

/* ------------------------------------ "Testar o agente" ------------------------------------ */

export async function runAgentTest(ctx: Ctx, sessionId: string | null, deps: PainelDeps, ia: DepsIa): Promise<ResultadoTeste> {
  const session = await loadSession(ctx, deps, sessionId ?? "");
  const dados = await rls(ctx, deps, async (tx) => {
    const [profile, config] = await Promise.all([
      tx.waAgentProfile.findUnique({ where: { sessionId: session.id } }),
      tx.waAgentConfig.findUnique({ where: { sessionId_agente: { sessionId: session.id, agente: "qualificacao" } } }),
    ]);
    return { profile, config };
  });
  const regras = lerRegras(dados.profile?.regrasNegocio ?? null);
  if (!regrasPreenchidas(regras) || !regras.casosTeste.length) {
    throw new PainelError("no_test_cases", "There are no test cases yet. Train with a document that has decision examples, or add them in the business rules.", 409);
  }
  const { provider, model } = await ia.modelo(false);
  const chave = await ia.chave(provider);
  if (!chave) throw new PainelError("no_ai_key", "There is no AI key in /admin > AI keys yet. Ask the admin to add one.", 409);
  const profile: AgentProfile = {
    baseCommand: dados.profile?.baseCommand ?? "",
    styleSummary: dados.profile?.styleSummary ?? null,
    styleExamples: null,
    quietHours: null,
    maxAutoPerDay: 0,
    fatosPermitidos: Array.isArray(dados.profile?.fatosPermitidos) ? (dados.profile!.fatosPermitidos as unknown[]).filter((f): f is string => typeof f === "string") : [],
    regras,
  };
  return testarAgente(
    { regras, profile, config: { agente: "qualificacao", ativo: true, provider, modelo: model, instrucoes: dados.config?.instrucoes ?? null } },
    {
      chamar: ia.chamar,
      provider,
      modelo: model,
      apiKey: chave,
      precos: ia.precos,
      conferirTeto: ia.conferirTeto,
      registrarUso: (u) => ia.registrarUso({ provider, modelo: u.modelo, uso: u.uso }),
    }
  );
}

