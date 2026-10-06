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
import { renderMemory } from "@/lib/whatsapp/cerebro/memory";
import { createPrismaSqlExecutor, type PrismaRawLike } from "@/lib/whatsapp/cerebro/sql";
import { CerebroStore } from "@/lib/whatsapp/cerebro/store";
import { enqueuePlanned } from "@/lib/whatsapp/outbound";
import type { WaQueuePort } from "@/lib/whatsapp/queue";
import type { WaRepository } from "@/lib/whatsapp/repository";
import type { BubblePlan } from "@/lib/whatsapp/pacing";

/** Últimas mensagens que o agente lê. */
export const HISTORICO_MAX = 40;

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
   * Não grava nada por enquanto: atualizar a memória pede uma chamada de IA a
   * mais (updateContactMemory do cérebro). Fica pra quando o dono quiser
   * pagar por isso (pendência registrada no documento de entrega).
   */
  async salvarMemoria(): Promise<void> {}
}
