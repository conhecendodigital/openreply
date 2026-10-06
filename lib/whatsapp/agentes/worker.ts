/**
 * Liga o motor dos agentes ao conector, no worker (fila wa-agent).
 *
 * - Mensagem nova do contato -> job "inbound" ~4 s depois (junta mensagens
 *   seguidas) -> aoMensagemDoContato (cancela o que esperava) -> processarMensagem.
 * - Eco "o dono respondeu pelo celular" -> job "owner" ~30 s depois: relê a
 *   mensagem; se ainda é USER_PHONE (não era eco do próprio Lead Engine), o
 *   agente pausa na conversa (aoMensagemDoUsuario).
 * - Envio do agente (fila wa-send): antes de cada bolha, podeEnviar(runId);
 *   no fim, o run vira "sent".
 *
 * IA: chave e modelo do /admin (lib/ai), teto em dólar do /admin, preços do
 * /admin e cada chamada no relatório de gastos (recordAiUsage). O Jev (triagem
 * e checagem) só entra com WHATSAPP_JEV=1, porque manda texto da conversa pra
 * TypeSafe (ponto em aberto de LGPD); sem ele tudo vira rascunho.
 */
import { getAiCredential, getAiSettings } from "@/lib/ai/credentials";
import { MODEL_JEV } from "@/lib/ai/catalog";
import { recordAiUsage } from "@/lib/ai/usage";
import { processarMensagem, podeEnviar, type DepsMotor } from "@/lib/whatsapp/agentes/motor";
import { aoMensagemDoContato, aoMensagemDoUsuario } from "@/lib/whatsapp/agentes/modo";
import { precosDaPlataforma } from "@/lib/whatsapp/agentes/modelos";
import { PrismaAgentStore } from "@/lib/whatsapp/agentes/store-prisma";
import type { BrainRetriever } from "@/lib/whatsapp/agentes/types";
import { defaultEmbeddingResolver, cerebroForUser } from "@/lib/whatsapp/cerebro/service";
import { searchKnowledge } from "@/lib/whatsapp/cerebro/search";
import type { IngestDeps } from "@/lib/whatsapp/ingest";
import type { ProcessSendDeps } from "@/lib/whatsapp/outbound";
import type { PrismaWaRepository } from "@/lib/whatsapp/prisma-repository";
import { enqueueAgentJob, removePendingSend, type WaAgentJob, type WaQueuePort } from "@/lib/whatsapp/queue";
import type { WaRepository } from "@/lib/whatsapp/repository";

export interface AgentWorkerDeps {
  repo: WaRepository & Pick<PrismaWaRepository, "getMessageSentBy">;
  queue: WaQueuePort;
  env?: Record<string, string | undefined>;
}

export function jevLigado(env: Record<string, string | undefined> = process.env): boolean {
  return env.WHATSAPP_JEV === "1";
}

export function storeFor(ownerUserId: string, workspaceId: string, deps: { repo: WaRepository; queue: WaQueuePort }) {
  return new PrismaAgentStore(ownerUserId, workspaceId, { repo: deps.repo, queue: deps.queue, removePendingSend });
}

/** Busca no cérebro do agente (PDFs). Sem chave OpenAI no /admin, volta vazio. */
export function brainFor(workspaceId: string): BrainRetriever {
  return {
    async buscar({ ownerUserId, sessionId, agente, consulta }) {
      const embedder = await defaultEmbeddingResolver.forOwner(ownerUserId);
      if (!embedder) return [];
      const { store, usage } = await cerebroForUser(ownerUserId, workspaceId);
      const { hits } = await searchKnowledge(
        { scope: { ownerUserId, workspaceId }, agentKind: agente, sessionId, question: consulta, k: 4 },
        { store, embedder, usage }
      );
      return hits.map((h) => ({ texto: h.content, fonte: h.fileName, pagina: h.page }));
    },
  };
}

/** Tudo que o motor precisa pra uma conversa, com as chaves e tetos do /admin. */
export async function motorDeps(job: Pick<WaAgentJob, "ownerUserId" | "workspaceId">, deps: AgentWorkerDeps): Promise<DepsMotor> {
  const settings = await getAiSettings();
  const env = deps.env ?? process.env;
  const jevKey = jevLigado(env) ? (await getAiCredential("typesafe"))?.apiKey ?? "" : "";
  return {
    store: storeFor(job.ownerUserId, job.workspaceId, deps),
    cerebro: brainFor(job.workspaceId),
    limites: { tetoUsuarioUsd: settings.dailyCapUserUsd, tetoWorkspaceUsd: settings.dailyCapWorkspaceUsd },
    precos: precosDaPlataforma(settings.prices),
    jev: {
      apiKey: jevKey,
      aoUsar: async (tokens) => {
        await recordAiUsage(
          { ownerUserId: job.ownerUserId, workspaceId: job.workspaceId, kind: "triage", agent: "triagem", provider: "typesafe", model: MODEL_JEV, tokensIn: tokens },
          { settings }
        );
      },
    },
    registrarUso: async (u) => {
      await recordAiUsage(
        {
          ownerUserId: u.ownerUserId,
          workspaceId: u.workspaceId,
          kind: "agent",
          agent: u.agente,
          provider: u.provider,
          model: u.modelo,
          contactId: u.contactId,
          conversationId: u.conversationId,
          tokensIn: u.uso.tokensIn,
          tokensOut: u.uso.tokensOut,
          cacheRead: u.uso.cacheRead,
          cacheWrite: u.uso.cacheWrite,
          blocked: u.bloqueado,
          refId: u.runId,
        },
        { settings }
      );
    },
  };
}

/** Processa um job da fila wa-agent. Só ids e status no log. */
export async function processAgentJob(job: WaAgentJob, deps: AgentWorkerDeps) {
  if (job.kind === "owner") {
    const msg = await deps.repo.getMessageSentBy(job.messageId);
    // Virou AGENT/USER_APP: era o eco do que o próprio Lead Engine mandou.
    if (!msg || !msg.fromMe || msg.sentBy !== "USER_PHONE") return { acao: "ignorado", motivo: "não foi o dono" };
    const store = storeFor(job.ownerUserId, job.workspaceId, deps);
    await aoMensagemDoUsuario(store, job.conversationId, "USER_PHONE");
    return { acao: "pausado", motivo: "o dono respondeu pelo celular" };
  }
  const motor = await motorDeps(job, deps);
  await aoMensagemDoContato(motor.store, job.conversationId);
  return processarMensagem(motor, { conversationId: job.conversationId, triggerMsgId: job.messageId });
}

/** Ganchos do wa-ingest com o workspace da sessão (lido no repositório). */
export function agentIngestHooks(
  repo: Pick<WaRepository, "getSession">,
  enqueue: (job: WaAgentJob) => Promise<void> = enqueueAgentJob
): Pick<IngestDeps, "onInboundMessage" | "onOwnerMessage"> {
  const jobFor = async (kind: WaAgentJob["kind"], info: { ownerUserId: string; sessionId: string; conversationId: string; messageId: string }) => {
    const session = await repo.getSession(info.sessionId);
    if (!session) return;
    await enqueue({ kind, ownerUserId: info.ownerUserId, workspaceId: session.workspaceId, sessionId: info.sessionId, conversationId: info.conversationId, messageId: info.messageId });
  };
  return {
    onInboundMessage: (info) => jobFor("inbound", info),
    onOwnerMessage: (info) => jobFor("owner", info),
  };
}

/** Ganchos do wa-send pros envios do agente (podeEnviar antes de cada bolha, "sent" no fim). */
export function agentSendHooks(deps: { repo: WaRepository; queue: WaQueuePort }): Pick<ProcessSendDeps, "canSendBubble" | "onFinished"> {
  const storeOf = async (request: { sessionId: string; ownerUserId: string }) => {
    const session = await deps.repo.getSession(request.sessionId);
    return session ? storeFor(session.ownerUserId, session.workspaceId, deps) : null;
  };
  return {
    async canSendBubble(request, _index, remainingMs) {
      if (request.sentBy !== "AGENT" || !request.agentRunId) return true;
      const store = await storeOf(request);
      if (!store) return false;
      const r = await podeEnviar(store, { runId: request.agentRunId, duracaoRestanteMs: remainingMs });
      return r.ok;
    },
    async onFinished(request, result) {
      if (request.sentBy !== "AGENT" || !request.agentRunId || result.status !== "sent") return;
      const store = await storeOf(request);
      await store?.atualizarRun(request.agentRunId, { status: "sent" });
    },
  };
}
