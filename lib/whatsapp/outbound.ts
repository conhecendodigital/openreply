/**
 * Fila de saída: tudo que o Lead Engine manda no WhatsApp passa por aqui,
 * nos dois conectores.
 *
 * 1. REGRA DAS 24H: só sai se a última mensagem do CONTATO tiver menos de 24h.
 *    Fora disso o envio é barrado e registrado (recordBlockedSend). Conferida
 *    ao enfileirar E de novo antes de cada bolha (a janela pode fechar no meio).
 * 2. "Assumir": mensagem do agente não sai enquanto humanTakeoverUntil > agora.
 * 3. RITMO HUMANO: quebra em mensagens curtas, espera de leitura, "digitando..."
 *    proporcional ao tamanho com variação, pausa entre bolhas e limite por
 *    minuto por número.
 */
import { randomUUID } from "node:crypto";
import type { WhatsAppConnector } from "@/lib/whatsapp/connector";
import { DEFAULT_PACING, isWithinReplyWindow, planBubbles, typingDelayMs, type BubblePlan, type PacingConfig, type Rand, type SendRateLimiter } from "@/lib/whatsapp/pacing";
import type { WaQueuePort, WaSendJob } from "@/lib/whatsapp/queue";
import type { WaRepository } from "@/lib/whatsapp/repository";
import type { BlockReason, OutboundRequest, WaSessionRecord } from "@/lib/whatsapp/types";

export type GateResult = { ok: true; lastInboundProviderMessageId: string } | { ok: false; reason: BlockReason };

function previewOf(request: OutboundRequest): string | null {
  const c = request.content;
  const text = c.type === "text" ? c.text : c.type === "media" ? c.caption ?? `[${c.mediaType}]` : `[template ${c.name}]`;
  return text ? text.slice(0, 80) : null;
}

/** As travas que valem pra qualquer envio, nos dois conectores. */
export async function checkSendGate(repo: WaRepository, request: OutboundRequest, now: number): Promise<GateResult> {
  const conversation = await repo.getConversation(request.conversationId);
  if (!conversation || conversation.ownerUserId !== request.ownerUserId || conversation.sessionId !== request.sessionId) {
    return { ok: false, reason: "sem_mensagem_do_contato" };
  }
  if (request.sentBy === "AGENT" && conversation.humanTakeoverUntil && conversation.humanTakeoverUntil.getTime() > now) {
    return { ok: false, reason: "humano_assumiu" };
  }
  const last = await repo.findLastInboundMessage(request.conversationId);
  if (!last) return { ok: false, reason: "sem_mensagem_do_contato" };
  if (!isWithinReplyWindow(last.sentAt, now)) return { ok: false, reason: "fora_da_janela_24h" };
  return { ok: true, lastInboundProviderMessageId: last.providerMessageId };
}

async function block(repo: WaRepository, request: OutboundRequest, reason: BlockReason, now: number) {
  await repo.recordBlockedSend({
    ownerUserId: request.ownerUserId,
    sessionId: request.sessionId,
    conversationId: request.conversationId,
    sentBy: request.sentBy,
    reason,
    agentRunId: request.agentRunId ?? null,
    preview: previewOf(request),
    at: new Date(now),
  });
}

export function planFor(request: OutboundRequest, rand: Rand, pacing: PacingConfig): BubblePlan[] {
  const c = request.content;
  if (c.type === "text") return planBubbles(c.text, rand, pacing);
  // Mídia e template: um envio só, com "digitando..." pelo tamanho da legenda.
  const caption = c.type === "media" ? c.caption ?? "" : "";
  return [
    {
      text: caption,
      waitBeforeTypingMs: Math.round(pacing.readDelayMs[0] + (pacing.readDelayMs[1] - pacing.readDelayMs[0]) * rand()),
      typingMs: typingDelayMs(caption || "......................", rand, pacing),
    },
  ];
}

export interface EnqueueDeps {
  repo: WaRepository;
  queue: WaQueuePort;
  now?: () => number;
  rand?: Rand;
  pacing?: PacingConfig;
}

export type EnqueueResult =
  | { status: "queued"; outboxId: string; bubbles: number }
  | { status: "blocked"; reason: BlockReason };

export async function enqueueOutbound(request: OutboundRequest, deps: EnqueueDeps): Promise<EnqueueResult> {
  const now = (deps.now ?? Date.now)();
  const gate = await checkSendGate(deps.repo, request, now);
  if (!gate.ok) {
    await block(deps.repo, request, gate.reason, now);
    return { status: "blocked", reason: gate.reason };
  }
  if (request.content.type === "text" && !request.content.text.trim()) {
    throw new Error("Mensagem vazia");
  }
  const plan = planFor(request, deps.rand ?? Math.random, deps.pacing ?? DEFAULT_PACING);
  const outboxId = randomUUID();
  await deps.queue.addSend({ outboxId, request, plan, nextIndex: 0 });
  return { status: "queued", outboxId, bubbles: plan.length };
}

export interface ProcessSendDeps {
  repo: WaRepository;
  getConnector: (session: WaSessionRecord) => Promise<WhatsAppConnector> | WhatsAppConnector;
  limiter: SendRateLimiter;
  sleep: (ms: number) => Promise<void>;
  now?: () => number;
  /** Grava o progresso no job (BullMQ job.updateData) pra retentativa não repetir bolha. */
  onProgress?: (nextIndex: number) => Promise<void>;
}

export type ProcessSendResult =
  | { status: "sent"; sent: number }
  | { status: "blocked"; reason: BlockReason; sent: number }
  | { status: "rate_limited"; retryAfterMs: number; nextIndex: number; sent: number };

export async function processSendJob(job: WaSendJob, deps: ProcessSendDeps): Promise<ProcessSendResult> {
  const clock = deps.now ?? Date.now;
  const { request } = job;
  let sent = 0;

  const session = await deps.repo.getSession(request.sessionId);
  if (!session || session.ownerUserId !== request.ownerUserId || session.status !== "CONNECTED") {
    await block(deps.repo, request, "sessao_desconectada", clock());
    return { status: "blocked", reason: "sessao_desconectada", sent };
  }
  const conversation = await deps.repo.getConversation(request.conversationId);
  const contact = conversation ? await deps.repo.getContact(conversation.contactId) : null;
  if (!conversation || !contact) {
    await block(deps.repo, request, "sem_mensagem_do_contato", clock());
    return { status: "blocked", reason: "sem_mensagem_do_contato", sent };
  }
  const connector = await deps.getConnector(session);

  for (let i = job.nextIndex; i < job.plan.length; i++) {
    const bubble = job.plan[i];

    const gate = await checkSendGate(deps.repo, request, clock());
    if (!gate.ok) {
      await block(deps.repo, request, gate.reason, clock());
      return { status: "blocked", reason: gate.reason, sent };
    }

    const slot = await deps.limiter.acquire(session.id, clock());
    if (!slot.allowed) return { status: "rate_limited", retryAfterMs: slot.retryAfterMs, nextIndex: i, sent };

    await deps.sleep(bubble.waitBeforeTypingMs);
    // "digitando..." é cosmético: se falhar, a mensagem sai mesmo assim.
    await connector.setTyping(contact.jid, true, { replyToProviderMessageId: gate.lastInboundProviderMessageId }).catch(() => {});
    await deps.sleep(bubble.typingMs);

    const options = {
      idempotencyKey: `${job.outboxId}:${i}`,
      quotedProviderMessageId: i === 0 ? request.quotedProviderMessageId ?? null : null,
    };
    const c = request.content;
    const result =
      c.type === "text"
        ? await connector.sendText(contact.jid, bubble.text, options)
        : c.type === "media"
          ? await connector.sendMedia(contact.jid, c, options)
          : await connector.sendTemplate(contact.jid, c, options);
    await connector.setTyping(contact.jid, false).catch(() => {});

    const sentAt = new Date(result.timestamp);
    await deps.repo.insertMessage({
      ownerUserId: request.ownerUserId,
      conversationId: conversation.id,
      sessionId: session.id,
      providerMessageId: result.providerMessageId,
      fromMe: true,
      sentBy: request.sentBy,
      type: c.type === "media" ? c.mediaType : "text",
      body: c.type === "text" ? bubble.text : c.type === "media" ? c.caption ?? null : `[template ${c.name}]`,
      quotedId: options.quotedProviderMessageId,
      ack: "sent",
      agentRunId: request.agentRunId ?? null,
      sentAt,
    });
    await deps.repo.touchConversation(conversation.id, {
      lastMessageAt: sentAt,
      preview: (c.type === "text" ? bubble.text : previewOf(request))?.slice(0, 120) ?? null,
      incrementUnread: false,
    });
    sent += 1;
    await deps.onProgress?.(i + 1);
  }
  return { status: "sent", sent };
}
