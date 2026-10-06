/**
 * AgentStore de produção (Postgres, schema "whatsapp").
 *
 * Um store por (dono do número, workspace). Tudo que é do workspace passa por
 * withRls com o dono como pessoa: a RLS da Fase 0 confere de novo. Duas
 * exceções, só leitura e só no servidor:
 *  - a chave de IA (PlatformAiCredential do /admin), pelo papel de sistema,
 *    igual ao getAiCredential de lib/ai/credentials.ts;
 *  - a soma de gasto do dia pro teto (WaAiUsage tem RLS por pessoa, e o teto
 *    do workspace precisa somar todo mundo).
 *
 * Gasto do dia = WaAiUsage (agentes, embedding, Jev, tudo que já foi pago)
 *              + reservas em aberto (WaAgentRun "pending", o pior caso).
 * Assim nada é contado duas vezes: o run vira linha de WaAiUsage quando o
 * modelo responde, e deixa de ser "pending".
 */
import type { PrismaClient } from "@/app/generated/prisma/client";
import { getAgentModelConfig } from "@/lib/ai/credentials";
import { getAppPrisma, withRls, withSystemRole, type RlsContext } from "@/lib/db/rls";
import { getPrisma } from "@/lib/db/client";
import { DAILY_CAP_PADRAO } from "@/lib/whatsapp/agentes/credenciais";
import {
  AGENTES,
  type AgenteConfig,
  type AgentMode,
  type AgentRunRecord,
  type AgentStore,
  type AgenteTipo,
  type AiCredentialRecord,
  type ConversaContexto,
  type EnvioPlanejado,
  type GastoDia,
  type IaProvider,
  type MemoriaContato,
  type RunStatus,
  type SentBy,
} from "@/lib/whatsapp/agentes/types";
import { dropSensitive, emptyMemory, mergeMemory, renderMemory } from "@/lib/whatsapp/cerebro/memory";
import { lerRegras, regrasPreenchidas } from "@/lib/whatsapp/regras/esquema";
import { estagioValido, type Classificacao, type Estagio } from "@/lib/whatsapp/regras/estagio";
import { MAX_EXEMPLOS, type ExemploAprendido } from "@/lib/whatsapp/regras/exemplos";
import { lerFicha, type FichaLead } from "@/lib/whatsapp/regras/ficha";
import type { CasoAprendizado } from "@/lib/whatsapp/agentes/types";
import { createPrismaSqlExecutor, type PrismaRawLike } from "@/lib/whatsapp/cerebro/sql";
import { CerebroStore } from "@/lib/whatsapp/cerebro/store";
import { enqueuePlanned } from "@/lib/whatsapp/outbound";
import type { WaQueuePort } from "@/lib/whatsapp/queue";
import type { WaRepository } from "@/lib/whatsapp/repository";
import type { BubblePlan } from "@/lib/whatsapp/pacing";

/** Últimas mensagens que o agente lê. */
export const HISTORICO_MAX = 40;
/** Casos guardados por número pro relatório (os mais antigos saem). */
export const MAX_CASOS = 500;

function soDigitos(s: string): string {
  return s.replace(/\D/g, "");
}

/** Mesmo telefone (com ou sem +55, com ou sem o 9). */
export function mesmoTelefone(a: string, b: string): boolean {
  const x = soDigitos(a);
  const y = soDigitos(b);
  if (x.length < 8 || y.length < 8) return false;
  const semPais = (d: string) => (d.length > 11 && d.startsWith("55") ? d.slice(2) : d);
  const sem9 = (d: string) => (d.length === 11 && d[2] === "9" ? d.slice(0, 2) + d.slice(3) : d);
  return sem9(semPais(x)) === sem9(semPais(y));
}

export interface PrismaAgentStoreDeps {
  /** Repositório e fila do conector (envio passa pela regra das 24h de lá). */
  repo: WaRepository;
  queue: WaQueuePort;
  /** Tira da fila um envio que ainda não começou. */
  removePendingSend?: (outboxId: string) => Promise<boolean>;
  app?: PrismaClient;
  system?: PrismaClient;
}

type RunRow = {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  sessionId: string;
  conversationId: string;
  triggerMsgId: string;
  agente: string | null;
  mode: AgentMode;
  status: string;
  output: unknown;
  blockedReason: string | null;
  provider: string | null;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  custoUsdMicro: number;
  triagem: unknown;
  approvedBy: string | null;
  createdAt: Date;
};

function isAgente(v: unknown): v is AgenteTipo {
  return typeof v === "string" && (AGENTES as readonly string[]).includes(v);
}

function toRun(r: RunRow): AgentRunRecord {
  const out = r.output && typeof r.output === "object" ? (r.output as { bolhas?: unknown; motivo?: unknown }) : null;
  return {
    id: r.id,
    ownerUserId: r.ownerUserId,
    workspaceId: r.workspaceId,
    sessionId: r.sessionId,
    conversationId: r.conversationId,
    triggerMsgId: r.triggerMsgId,
    agente: isAgente(r.agente) ? r.agente : null,
    mode: r.mode,
    status: r.status as RunStatus,
    output: out
      ? {
          bolhas: Array.isArray(out.bolhas) ? out.bolhas.map(String) : [],
          motivo: typeof out.motivo === "string" ? out.motivo : null,
        }
      : null,
    blockedReason: r.blockedReason,
    provider: r.provider === "anthropic" || r.provider === "openai" ? r.provider : null,
    model: r.model,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    cacheRead: r.cacheRead,
    cacheWrite: r.cacheWrite,
    custoUsdMicro: r.custoUsdMicro,
    triagem: r.triagem,
    approvedBy: r.approvedBy,
    createdAt: r.createdAt,
  };
}

function runData(patch: Partial<AgentRunRecord>) {
  const data: Record<string, unknown> = {};
  const keys = [
    "agente",
    "mode",
    "status",
    "blockedReason",
    "provider",
    "model",
    "tokensIn",
    "tokensOut",
    "cacheRead",
    "cacheWrite",
    "approvedBy",
  ] as const;
  for (const k of keys) if (patch[k] !== undefined) data[k] = patch[k];
  if (patch.custoUsdMicro !== undefined) data.custoUsdMicro = Math.max(0, Math.round(patch.custoUsdMicro));
  if (patch.output !== undefined) data.output = patch.output ?? undefined;
  if (patch.triagem !== undefined) data.triagem = patch.triagem ?? undefined;
  if (typeof data.blockedReason === "string") data.blockedReason = (data.blockedReason as string).slice(0, 500);
  return data;
}

function quietHoursOf(v: unknown): { start: string; end: string } | null {
  if (!v || typeof v !== "object") return null;
  const q = v as Record<string, unknown>;
  const ok = (s: unknown) => typeof s === "string" && /^\d{2}:\d{2}$/.test(s);
  return ok(q.start) && ok(q.end) ? { start: q.start as string, end: q.end as string } : null;
}

function stringList(v: unknown, max = 50): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && Boolean(x.trim())).slice(0, max) : [];
}

export class PrismaAgentStore implements AgentStore {
  private readonly ctx: RlsContext;
  private readonly app: PrismaClient;
  private readonly system: PrismaClient;

  constructor(
    readonly ownerUserId: string,
    readonly workspaceId: string,
    private readonly deps: PrismaAgentStoreDeps
  ) {
    this.ctx = { userId: ownerUserId, workspaceId };
    this.app = deps.app ?? getAppPrisma();
    this.system = deps.system ?? getPrisma();
  }

  private rls<T>(fn: Parameters<typeof withRls<T>>[1]): Promise<T> {
    return withRls(this.ctx, fn, this.app);
  }

  async carregarContexto(conversationId: string): Promise<ConversaContexto | null> {
    return this.rls(async (tx) => {
      const c = await tx.waConversation.findFirst({
        where: { id: conversationId, workspaceId: this.workspaceId },
        include: {
          session: { select: { id: true, provider: true, agentMode: true, ownerUserId: true } },
          contact: { select: { id: true, isGroup: true, name: true, pushName: true } },
          labels: { include: { label: { select: { agentMode: true } } } },
        },
      });
      if (!c) return null;
      const [profile, mensagens] = await Promise.all([
        tx.waAgentProfile.findUnique({ where: { sessionId: c.sessionId } }),
        tx.waMessage.findMany({
          where: { conversationId },
          orderBy: { sentAt: "desc" },
          take: HISTORICO_MAX,
          select: { id: true, fromMe: true, sentBy: true, type: true, body: true, sentAt: true, mediaText: true, mediaTextKind: true },
        }),
      ]);
      return {
        ownerUserId: c.session.ownerUserId,
        workspaceId: c.workspaceId,
        session: { id: c.session.id, provider: c.session.provider, agentMode: c.session.agentMode },
        conversation: {
          id: c.id,
          agentMode: c.agentMode,
          humanTakeoverUntil: c.humanTakeoverUntil,
          labelModes: c.labels.map((l) => l.label.agentMode),
          lead: {
            ficha: lerFicha(c.leadFicha),
            estagio: estagioValido(c.leadStage) ? c.leadStage : null,
            manual: c.leadStageManual,
            motivo: c.leadStageMotivo,
          },
        },
        contact: { id: c.contact.id, isGroup: c.contact.isGroup, name: c.contact.name, pushName: c.contact.pushName },
        profile: profile
          ? {
              baseCommand: profile.baseCommand,
              styleSummary: profile.styleSummary,
              styleExamples: Array.isArray(profile.styleExamples)
                ? (profile.styleExamples as Array<{ pergunta?: unknown; resposta?: unknown }>)
                    .filter((e) => typeof e?.pergunta === "string" && typeof e?.resposta === "string")
                    .map((e) => ({ pergunta: e.pergunta as string, resposta: e.resposta as string }))
                : null,
              quietHours: quietHoursOf(profile.quietHours),
              maxAutoPerDay: profile.maxAutoPerDay,
              fatosPermitidos: stringList(profile.fatosPermitidos),
              timeZone: profile.timeZone,
              atrasoInicialMs: { min: profile.delayMinSeconds * 1000, max: profile.delayMaxSeconds * 1000 },
              regras: regrasDoPerfil(profile.regrasNegocio),
              avisarResponsavel: avisoDe(profile.avisarResponsavel),
            }
          : null,
        historico: mensagens.reverse().map((m) => ({ ...m, sentBy: m.sentBy as SentBy })),
      };
    });
  }

  /** Os 3 agentes do número (os que não têm linha nascem desligados) com provedor e modelo do /admin. */
  async configAgentes(_ownerUserId: string, sessionId: string): Promise<AgenteConfig[]> {
    const rows = await this.rls((tx) => tx.waAgentConfig.findMany({ where: { sessionId, workspaceId: this.workspaceId } }));
    const out: AgenteConfig[] = [];
    for (const agente of AGENTES) {
      const row = rows.find((r) => r.agente === agente);
      const plataforma = await getAgentModelConfig(agente, this.system);
      out.push({
        agente,
        ativo: Boolean(row?.ativo),
        provider: plataforma.provider,
        modelo: plataforma.model,
        modeloDificil: plataforma.hardModel,
        instrucoes: row?.instrucoes ?? null,
      });
    }
    return out;
  }

  /**
   * Chave do provedor cadastrada no /admin (a mesma pra todo o beta). O motor
   * abre `keyEnc` com abrirChave na hora de chamar o modelo. `dailyCap` =
   * respostas por dia por pessoa (o teto em dólar fica no /admin).
   */
  async credencialAtiva(ownerUserId: string, provider: IaProvider): Promise<AiCredentialRecord | null> {
    const row = await withSystemRole(
      (tx) =>
        tx.platformAiCredential.findUnique({
          where: { provider },
          select: { id: true, keyEnc: true, keyLast4: true, active: true, createdAt: true },
        }),
      this.system
    );
    if (!row || !row.active) return null;
    return {
      id: row.id,
      ownerUserId,
      provider,
      keyEnc: row.keyEnc,
      keyLast4: row.keyLast4,
      dailyCap: DAILY_CAP_PADRAO,
      createdAt: row.createdAt,
      revokedAt: null,
    };
  }

  async salvarCredencial(): Promise<AiCredentialRecord> {
    throw new Error("A chave de IA é cadastrada no /admin (Chaves de IA).");
  }

  async revogarCredencial(): Promise<void> {
    throw new Error("A chave de IA é cadastrada no /admin (Chaves de IA).");
  }

  async listarCredenciais(): Promise<AiCredentialRecord[]> {
    return [];
  }

  async gastoDoDia(
    escopo: { ownerUserId: string } | { workspaceId: string } | { sessionId: string },
    desde: Date
  ): Promise<GastoDia> {
    return withSystemRole(async (tx) => {
      if ("sessionId" in escopo) {
        const autoEnvios = await tx.waAgentRun.count({
          where: { sessionId: escopo.sessionId, createdAt: { gte: desde }, status: { in: ["scheduled", "sent"] }, approvedBy: null },
        });
        const respostas = await tx.waAgentRun.count({ where: { sessionId: escopo.sessionId, createdAt: { gte: desde }, model: { not: null } } });
        return { custoUsdMicro: 0, respostas, autoEnvios };
      }
      const usageWhere = "ownerUserId" in escopo ? { ownerUserId: escopo.ownerUserId } : { workspaceId: escopo.workspaceId };
      const [pago, reservado, respostas, autoEnvios] = await Promise.all([
        tx.waAiUsage.aggregate({ where: { ...usageWhere, createdAt: { gte: desde } }, _sum: { costMicroUsd: true } }),
        tx.waAgentRun.aggregate({ where: { ...usageWhere, createdAt: { gte: desde }, status: "pending" }, _sum: { custoUsdMicro: true } }),
        tx.waAgentRun.count({ where: { ...usageWhere, createdAt: { gte: desde }, model: { not: null } } }),
        tx.waAgentRun.count({ where: { ...usageWhere, createdAt: { gte: desde }, status: { in: ["scheduled", "sent"] }, approvedBy: null } }),
      ]);
      return {
        custoUsdMicro: Number(pago._sum.costMicroUsd ?? 0) + Number(reservado._sum.custoUsdMicro ?? 0),
        respostas,
        autoEnvios,
      };
    }, this.system);
  }

  async registrarRun(run: AgentRunRecord): Promise<string> {
    const row = await this.rls((tx) =>
      tx.waAgentRun.create({
        data: {
          workspaceId: this.workspaceId,
          ownerUserId: run.ownerUserId,
          sessionId: run.sessionId,
          conversationId: run.conversationId,
          triggerMsgId: run.triggerMsgId,
          mode: run.mode,
          status: run.status,
          ...runData(run),
          createdAt: run.createdAt,
        } as never,
        select: { id: true },
      })
    );
    return row.id;
  }

  async atualizarRun(id: string, patch: Partial<AgentRunRecord>): Promise<void> {
    await this.rls((tx) => tx.waAgentRun.updateMany({ where: { id, workspaceId: this.workspaceId }, data: runData(patch) as never }));
  }

  async marcarAprovado(runId: string, aprovadoPor: string, output: { bolhas: string[]; motivo?: string | null }) {
    const { count } = await this.rls((tx) =>
      tx.waAgentRun.updateMany({
        where: { id: runId, workspaceId: this.workspaceId, status: "draft" },
        data: { status: "approved", approvedBy: aprovadoPor, output: { bolhas: output.bolhas, motivo: output.motivo ?? null } },
      })
    );
    return count === 1;
  }

  async buscarRun(id: string): Promise<AgentRunRecord | null> {
    const row = await this.rls((tx) => tx.waAgentRun.findFirst({ where: { id, workspaceId: this.workspaceId } }));
    return row ? toRun(row as RunRow) : null;
  }

  async runsPendentes(conversationId: string): Promise<AgentRunRecord[]> {
    const rows = await this.rls((tx) =>
      tx.waAgentRun.findMany({
        where: { conversationId, workspaceId: this.workspaceId, status: { in: ["draft", "scheduled"] } },
        orderBy: { createdAt: "asc" },
      })
    );
    return rows.map((r) => toRun(r as RunRow));
  }

  /**
   * Entrega as bolhas pra fila wa-send do conector (que confere a regra das
   * 24h e o "Assumir" de novo). O atraso da 1ª bolha vira atraso da fila; o
   * id do envio é o id do run, pra dar pra cancelar depois.
   */
  async agendarEnvio(input: { runId: string; conversationId: string; sessionId: string; envios: EnvioPlanejado[] }): Promise<string> {
    const plan: BubblePlan[] = input.envios.map((e, i) => ({
      text: e.texto,
      waitBeforeTypingMs: i === 0 ? 0 : e.esperaMs,
      typingMs: e.digitandoMs,
    }));
    const result = await enqueuePlanned(
      {
        ownerUserId: this.ownerUserId,
        sessionId: input.sessionId,
        conversationId: input.conversationId,
        sentBy: "AGENT",
        content: { type: "text", text: input.envios.map((e) => e.texto).join("\n\n") },
        agentRunId: input.runId,
      },
      plan,
      { repo: this.deps.repo, queue: this.deps.queue },
      { outboxId: input.runId, delayMs: input.envios[0]?.esperaMs ?? 0 }
    );
    if (result.status !== "queued") throw new Error(`envio barrado: ${result.reason}`);
    return result.outboxId;
  }

  async cancelarEnvios(conversationId: string): Promise<number> {
    if (!this.deps.removePendingSend) return 0;
    const agendados = await this.rls((tx) =>
      tx.waAgentRun.findMany({
        where: { conversationId, workspaceId: this.workspaceId, status: { in: ["scheduled", "approved"] } },
        select: { id: true },
      })
    );
    let n = 0;
    for (const r of agendados) {
      if (await this.deps.removePendingSend(r.id).catch(() => false)) n++;
    }
    return n;
  }

  async definirTakeover(conversationId: string, ate: Date | null): Promise<void> {
    await this.rls((tx) =>
      tx.waConversation.updateMany({ where: { id: conversationId, workspaceId: this.workspaceId }, data: { humanTakeoverUntil: ate } })
    );
  }

  /** Memória do contato = a do cérebro (WaContactMemory), já resumida em texto. */
  async lerMemoria(contactId: string): Promise<MemoriaContato | null> {
    // Mesmo executor do cérebro (RLS do dono + workspace, papel le_app).
    const db = createPrismaSqlExecutor(this.app as unknown as PrismaRawLike, { userId: this.ownerUserId, workspaceId: this.workspaceId });
    const mem = await new CerebroStore(db).getMemory(this.workspaceId, contactId);
    if (!mem) return null;
    return { resumo: renderMemory(mem) || null, fatos: [], ultimoAgente: null, atualizadoEm: mem.updatedAt };
  }

  /**
   * Não grava nada aqui: a memória do cérebro é atualizada por
   * gravarMemoriaContato, com o que a chamada barata da ficha do lead devolve.
   */
  async salvarMemoria(): Promise<void> {}

  /* ---------------- Regras duras, ficha, estágio e aprendizado ---------------- */

  async exemplosAprendidos(sessionId: string): Promise<ExemploAprendido[]> {
    const rows = await this.rls((tx) =>
      tx.waAgentExample.findMany({ where: { sessionId, workspaceId: this.workspaceId }, orderBy: { createdAt: "desc" }, take: MAX_EXEMPLOS })
    );
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      agente: isAgente(r.agente) ? r.agente : null,
      origem: r.origem === "assumir" ? "assumir" : "edicao",
      origemId: r.origemId,
      pergunta: r.pergunta,
      resposta: r.resposta,
      rascunho: r.rascunho,
      createdAt: r.createdAt,
    }));
  }

  async registrarExemplo(ex: ExemploAprendido): Promise<void> {
    await this.rls(async (tx) => {
      await tx.waAgentExample.createMany({
        data: [
          {
            workspaceId: this.workspaceId,
            ownerUserId: this.ownerUserId,
            sessionId: ex.sessionId,
            agente: ex.agente,
            origem: ex.origem,
            origemId: ex.origemId.slice(0, 200),
            pergunta: ex.pergunta.slice(0, 600),
            resposta: ex.resposta.slice(0, 1200),
            rascunho: ex.rascunho ? ex.rascunho.slice(0, 1200) : null,
          },
        ],
        skipDuplicates: true,
      });
      // Limite por número: os mais antigos saem.
      const velhos = await tx.waAgentExample.findMany({
        where: { sessionId: ex.sessionId, workspaceId: this.workspaceId },
        orderBy: { createdAt: "desc" },
        skip: MAX_EXEMPLOS,
        select: { id: true },
      });
      if (velhos.length) await tx.waAgentExample.deleteMany({ where: { id: { in: velhos.map((v) => v.id) } } });
    });
  }

  async registrarCaso(c: CasoAprendizado): Promise<void> {
    await this.rls(async (tx) => {
      await tx.waAgentLearningCase.createMany({
        data: [
          {
            workspaceId: this.workspaceId,
            ownerUserId: this.ownerUserId,
            sessionId: c.sessionId,
            tipo: c.tipo,
            regra: c.regra?.slice(0, 200) ?? null,
            assunto: c.assunto?.slice(0, 120) ?? null,
            pergunta: c.pergunta?.slice(0, 600) || null,
            resposta: c.resposta?.slice(0, 1200) || null,
            conversaHash: c.conversaHash ?? null,
            origemId: c.origemId.slice(0, 200),
          },
        ],
        skipDuplicates: true,
      });
      const velhos = await tx.waAgentLearningCase.findMany({
        where: { sessionId: c.sessionId, workspaceId: this.workspaceId },
        orderBy: { createdAt: "desc" },
        skip: MAX_CASOS,
        select: { id: true },
      });
      if (velhos.length) await tx.waAgentLearningCase.deleteMany({ where: { id: { in: velhos.map((v) => v.id) } } });
    });
  }

  async salvarFicha(conversationId: string, ficha: FichaLead): Promise<void> {
    await this.rls((tx) =>
      tx.waConversation.updateMany({ where: { id: conversationId, workspaceId: this.workspaceId }, data: { leadFicha: ficha as never } })
    );
  }

  async salvarEstagio(input: { conversationId: string; sessionId: string; de: Estagio | null; nova: Classificacao; manual: boolean; porUserId: string | null }): Promise<void> {
    await gravarEstagio(this.rls.bind(this), this.workspaceId, input);
  }

  async gravarMemoriaContato(contactId: string, update: Partial<Record<"nome" | "interesse" | "objecao" | "etapa" | "observacao", unknown>>): Promise<void> {
    const db = createPrismaSqlExecutor(this.app as unknown as PrismaRawLike, { userId: this.ownerUserId, workspaceId: this.workspaceId });
    const store = new CerebroStore(db);
    const scope = { ownerUserId: this.ownerUserId, workspaceId: this.workspaceId };
    const limpo = dropSensitive(update);
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const atual = await store.getMemory(this.workspaceId, contactId);
      const antes = atual
        ? { nome: atual.nome, interesse: atual.interesse, objecao: atual.objecao, etapa: atual.etapa, observacao: atual.observacao }
        : emptyMemory();
      const nova = mergeMemory(antes, limpo);
      if (await store.saveMemory(scope, contactId, nova, atual ? atual.version : null)) return;
    }
  }

  /**
   * Resumo do lead qualificado pro WhatsApp do responsável, pelo mesmo número.
   * Só sai se o responsável já tem conversa com esse número e a janela de 24h
   * está aberta (a regra do conector vale aqui também).
   */
  async avisarResponsavel(input: { sessionId: string; telefone: string; texto: string }): Promise<{ ok: true } | { ok: false; motivo: string }> {
    const digitos = soDigitos(input.telefone);
    if (digitos.length < 10) return { ok: false, motivo: "o telefone do responsável está incompleto" };
    const candidatos = await this.rls((tx) =>
      tx.waContact.findMany({
        where: { sessionId: input.sessionId, workspaceId: this.workspaceId, isGroup: false, phoneE164: { contains: digitos.slice(-8) } },
        select: { phoneE164: true, conversations: { select: { id: true }, take: 1 } },
        take: 10,
      })
    );
    const contato = candidatos.find((c) => c.phoneE164 && mesmoTelefone(c.phoneE164, input.telefone));
    const conversationId = contato?.conversations[0]?.id;
    if (!conversationId) return { ok: false, motivo: "o responsável ainda não mandou mensagem pra esse número" };
    const result = await enqueuePlanned(
      { ownerUserId: this.ownerUserId, sessionId: input.sessionId, conversationId, sentBy: "AGENT", content: { type: "text", text: input.texto } },
      [{ text: input.texto, waitBeforeTypingMs: 0, typingMs: 1_500 }],
      { repo: this.deps.repo, queue: this.deps.queue }
    );
    if (result.status === "queued") return { ok: true };
    return { ok: false, motivo: result.reason === "fora_da_janela_24h" ? "passaram 24h da última mensagem do responsável" : "o envio foi barrado" };
  }
}

type RlsFn = <T>(fn: (tx: Parameters<Parameters<typeof withRls>[1]>[0]) => Promise<T>) => Promise<T>;

/** Grava o estágio e o histórico juntos (o agente ou o dono). */
export async function gravarEstagio(
  rls: RlsFn,
  workspaceId: string,
  input: { conversationId: string; sessionId: string; de: Estagio | null; nova: Classificacao; manual: boolean; porUserId: string | null }
): Promise<void> {
  const motivo = input.nova.motivo.slice(0, 500) || null;
  await rls(async (tx) => {
    const { count } = await tx.waConversation.updateMany({
      where: { id: input.conversationId, workspaceId },
      data: {
        leadStage: input.nova.estagio,
        leadStageMotivo: motivo,
        leadStageTipo: input.nova.tipo,
        leadStageManual: input.manual,
        leadStageAt: new Date(),
      },
    });
    if (!count) return;
    await tx.waLeadStageEvent.create({
      data: {
        workspaceId,
        sessionId: input.sessionId,
        conversationId: input.conversationId,
        de: input.de,
        para: input.nova.estagio,
        motivo,
        tipo: input.nova.tipo,
        manual: input.manual,
        porUserId: input.porUserId,
      },
      select: { id: true },
    });
  });
}

/** Regras do perfil (null = o dono ainda não tem regra nenhuma: o motor segue como antes). */
export function regrasDoPerfil(v: unknown) {
  if (v === null || v === undefined) return null;
  const r = lerRegras(v);
  return regrasPreenchidas(r) ? r : null;
}

function avisoDe(v: unknown): { ligado: boolean; telefone: string } | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return { ligado: o.ligado === true, telefone: typeof o.telefone === "string" ? o.telefone.slice(0, 30) : "" };
}
