/**
 * Textos programados do WhatsApp (2026-10-08, pedido do dono): uma fila por
 * conversa que sai sozinha todo dia às 6h de Brasília, 10 por dia, uma
 * mensagem por item, com uma pausa entre elas. Primeiro uso: os roteiros do
 * dia mandados do número "Automação" pro WhatsApp do próprio dono, que copia
 * no Edits. Ele dá "boa noite" à noite pra janela de 24 h estar aberta às 6h.
 *
 * Regras: cada rótulo (ex.: "R507") entra uma vez só por conversa; sai no
 * máximo um lote por conversa por dia; se a janela estiver fechada ou o
 * número desconectado, nada é forçado: o resto fica pro dia seguinte e
 * fica um aviso em Eventos. Nada é apagado: "tirar da fila" marca REMOVED.
 */
import { withRls, withSystemRole } from "@/lib/db/rls";
import { prisma } from "@/lib/db/client";
import { enqueuePlanned, humanReplyPlan } from "@/lib/whatsapp/outbound";
import { PainelError, rls, type PainelDeps } from "@/lib/whatsapp/painel";

export const POR_DIA = 10;
export const MAX_TEXTO = 4000;
export const MAX_ITENS_POR_VEZ = 100;
const FUSO_BRASILIA_MS = 3 * 3_600_000;

type Ctx = { userId: string; workspaceId: string };
export type ItemProgramado = { label: string; text: string };

/** "AAAA-MM-DD" do dia em Brasília (UTC-3, sem horário de verão). */
export function diaBrasilia(d: Date): string {
  return new Date(d.getTime() - FUSO_BRASILIA_MS).toISOString().slice(0, 10);
}

/** Meia-noite de Brasília do dia de `d`, em UTC. */
export function inicioDoDiaBrasilia(d: Date): Date {
  return new Date(`${diaBrasilia(d)}T03:00:00.000Z`);
}

/** Pausa entre uma mensagem e a próxima do lote: de 35 a 45 s. */
export function pausaEntreMensagens(rand: () => number = Math.random): number {
  return 35_000 + Math.floor(rand() * 10_000);
}

/** Confere o que veio da tela ou da API. Lança PainelError com a mensagem pra pessoa. */
export function validarItens(raw: unknown): ItemProgramado[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new PainelError("invalid", "Send at least one text.", 400);
  if (raw.length > MAX_ITENS_POR_VEZ) throw new PainelError("invalid", `At most ${MAX_ITENS_POR_VEZ} texts at a time.`, 400);
  return raw.map((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label.trim() : "";
    const text = typeof o.text === "string" ? o.text.trim() : "";
    if (!label || label.length > 80) throw new PainelError("invalid", "Each text needs a label of 1 to 80 characters.", 400);
    if (!text) throw new PainelError("invalid", "Each text needs some content.", 400);
    if (text.length > MAX_TEXTO) throw new PainelError("too_long", `The message is too long (${MAX_TEXTO} characters at most).`, 400);
    return { label, text };
  });
}

/** Põe textos no fim da fila da conversa. Rótulo repetido é ignorado (conta em "repetidos"). */
export async function adicionarProgramados(
  ctx: Ctx,
  deps: PainelDeps,
  input: { conversationId: unknown; itens: unknown }
): Promise<{ criados: number; repetidos: number }> {
  const conversationId = typeof input.conversationId === "string" ? input.conversationId : "";
  if (!conversationId) throw new PainelError("invalid", "Choose a conversation.", 400);
  const itens = validarItens(input.itens);
  return rls(ctx, deps, async (tx) => {
    const conv = await tx.waConversation.findFirst({ where: { id: conversationId, workspaceId: ctx.workspaceId }, select: { id: true } });
    if (!conv) throw new PainelError("not_found", "Conversation not found.", 404);
    const ult = await tx.waScheduledText.aggregate({ where: { conversationId }, _max: { position: true } });
    let pos = ult._max.position ?? 0;
    const ja = await tx.waScheduledText.findMany({
      where: { conversationId, label: { in: itens.map((i) => i.label) } },
      select: { label: true },
    });
    const vistos = new Set(ja.map((x) => x.label));
    let criados = 0;
    let repetidos = 0;
    for (const it of itens) {
      if (vistos.has(it.label)) {
        repetidos++;
        continue;
      }
      vistos.add(it.label);
      pos++;
      await tx.waScheduledText.create({
        data: { workspaceId: ctx.workspaceId, conversationId, label: it.label, text: it.text, position: pos, createdBy: ctx.userId },
      });
      criados++;
    }
    return { criados, repetidos };
  });
}

/** A fila (sem os tirados), na ordem de saída. */
export async function listarProgramados(ctx: Ctx, deps: PainelDeps, conversationId?: string | null) {
  const rows = await rls(ctx, deps, (tx) =>
    tx.waScheduledText.findMany({
      where: { workspaceId: ctx.workspaceId, status: { not: "REMOVED" }, ...(conversationId ? { conversationId } : {}) },
      orderBy: [{ conversationId: "asc" }, { position: "asc" }],
      select: { id: true, conversationId: true, label: true, text: true, status: true, position: true, queuedAt: true },
    })
  );
  return {
    porDia: POR_DIA,
    horario: "06:00 (Brasília)",
    pendentes: rows.filter((r) => r.status === "PENDING").length,
    itens: rows.map((r) => ({ ...r, text: r.text.slice(0, 120) })),
  };
}

/** Tira da fila um texto que ainda não saiu. */
export async function removerProgramado(ctx: Ctx, deps: PainelDeps, id: string): Promise<{ removido: true }> {
  const { count } = await rls(ctx, deps, (tx) =>
    tx.waScheduledText.updateMany({ where: { id, workspaceId: ctx.workspaceId, status: "PENDING" }, data: { status: "REMOVED" } })
  );
  if (count === 0) throw new PainelError("not_found", "This text is not waiting in the queue anymore.", 404);
  return { removido: true };
}

const MOTIVO: Record<string, string> = {
  fora_da_janela_24h: "a janela de 24 h fechou (faltou a mensagem de boa noite)",
  sem_mensagem_do_contato: "a pessoa ainda não mandou nenhuma mensagem pra esse número",
  humano_assumiu: "alguém assumiu a conversa",
  sessao_desconectada: "o número está desconectado",
  number_removed: "o número foi removido",
};

/**
 * O lote do dia (rota de cron às 09:00 UTC = 6h de Brasília). Idempotente:
 * conversa que já teve lote hoje é pulada. Só enfileira; quem envia é o
 * wa-worker, com o atraso de cada mensagem.
 */
export async function enviarProgramadosDoDia(
  deps: Pick<PainelDeps, "repo" | "queue">,
  opts: { now?: Date; porDia?: number; pausa?: () => number } = {}
) {
  const now = opts.now ?? new Date();
  const porDia = opts.porDia ?? POR_DIA;
  const pausa = opts.pausa ?? (() => pausaEntreMensagens());
  const desde = inicioDoDiaBrasilia(now);
  const grupos = await withSystemRole((tx) =>
    tx.waScheduledText.groupBy({ by: ["conversationId"], where: { status: "PENDING" } })
  );
  const conversas: { conversationId: string; enviados: number; motivo: string | null }[] = [];
  for (const { conversationId } of grupos) {
    const info = await withSystemRole(async (tx) => {
      const jaHoje = await tx.waScheduledText.findFirst({
        where: { conversationId, status: "QUEUED", queuedAt: { gte: desde } },
        select: { id: true },
      });
      const conv = await tx.waConversation.findUnique({
        where: { id: conversationId },
        select: { workspaceId: true, sessionId: true, session: { select: { ownerUserId: true, status: true, deletedAt: true } } },
      });
      const itens = await tx.waScheduledText.findMany({
        where: { conversationId, status: "PENDING" },
        orderBy: { position: "asc" },
        take: porDia,
        select: { id: true, label: true, text: true },
      });
      return { jaHoje: Boolean(jaHoje), conv, itens };
    });
    if (info.jaHoje) {
      conversas.push({ conversationId, enviados: 0, motivo: "ja_enviou_hoje" });
      continue;
    }
    if (!info.conv || info.itens.length === 0) {
      conversas.push({ conversationId, enviados: 0, motivo: "sem_itens" });
      continue;
    }
    const conv = info.conv;
    let motivo: string | null = conv.session.deletedAt ? "number_removed" : conv.session.status !== "CONNECTED" ? "sessao_desconectada" : null;
    let enviados = 0;
    let atraso = 0;
    if (!motivo) {
      for (const item of info.itens) {
        const r = await enqueuePlanned(
          { ownerUserId: conv.session.ownerUserId, sessionId: conv.sessionId, conversationId, sentBy: "USER_APP", content: { type: "text", text: item.text } },
          humanReplyPlan(item.text),
          { repo: deps.repo, queue: deps.queue, now: () => now.getTime() },
          { delayMs: atraso }
        );
        if (r.status === "blocked") {
          motivo = r.reason;
          break;
        }
        await withSystemRole((tx) => tx.waScheduledText.update({ where: { id: item.id }, data: { status: "QUEUED", queuedAt: now } }));
        enviados++;
        atraso += pausa();
      }
    }
    if (motivo) {
      await prisma.operationalEvent
        .create({
          data: {
            workspaceId: conv.workspaceId,
            source: "SYSTEM",
            level: "WARNING",
            message: `Envio programado das 6h: ${enviados} de ${info.itens.length} saíram. O resto fica pro próximo dia porque ${MOTIVO[motivo] ?? motivo}.`,
            payload: { kind: "wa_programados", conversationId, enviados, motivo },
          },
        })
        .catch(() => undefined);
    }
    conversas.push({ conversationId, enviados, motivo });
  }
  return { dia: diaBrasilia(now), conversas };
}

/**
 * Só rótulo e horário do que já saiu (nunca o texto). Lido também por chave de
 * API: o Mac do dono usa pra mover a pasta do roteiro pra "gravados" no Drive.
 */
export async function listarEnviados(ctx: Ctx, desde: Date, app?: PainelDeps["app"]) {
  const rows = await withRls(
    ctx,
    (tx) =>
      tx.waScheduledText.findMany({
        where: { workspaceId: ctx.workspaceId, status: "QUEUED", queuedAt: { gte: desde } },
        orderBy: [{ queuedAt: "asc" }, { position: "asc" }],
        select: { label: true, queuedAt: true, conversationId: true },
      }),
    app ?? undefined
  );
  const pendentes = await withRls(
    ctx,
    (tx) => tx.waScheduledText.count({ where: { workspaceId: ctx.workspaceId, status: "PENDING" } }),
    app ?? undefined
  );
  return { desde: desde.toISOString(), enviados: rows, pendentes };
}
