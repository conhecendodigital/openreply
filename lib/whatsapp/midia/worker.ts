/**
 * Liga a leitura de mídia ao worker (fila wa-agent), antes do motor.
 *
 * Só lê quando o agente vai rodar na conversa (algum agente ligado no número e
 * o modo não é OFF): sem agente, ninguém paga pra transcrever.
 *
 * - Bytes: os mesmos da tela de Conversas (messageMedia de lib/whatsapp/painel.ts,
 *   gateway OpenWA ou uazapi, com a RLS do dono do número).
 * - Chaves: /admin > Chaves de IA (getAiCredential).
 * - Teto: o mesmo do motor (teto.ts com o gasto do dia de WaAiUsage + reservas).
 * - Gasto: WaAiUsage com kind "midia" (aparece em Gastos de IA).
 */
import type { PrismaClient } from "@/app/generated/prisma/client";
import { getAiCredential, getAiSettings } from "@/lib/ai/credentials";
import { recordAiUsage } from "@/lib/ai/usage";
import { getPrisma } from "@/lib/db/client";
import { getAppPrisma, withRls } from "@/lib/db/rls";
import { precosDaPlataforma } from "@/lib/whatsapp/agentes/modelos";
import { janelaAberta, resolverModo } from "@/lib/whatsapp/agentes/modo";
import { conferirTeto } from "@/lib/whatsapp/agentes/teto";
import { storeFor } from "@/lib/whatsapp/agentes/worker";
import { messageMedia, type PainelDeps } from "@/lib/whatsapp/painel";
import type { WaAgentJob, WaQueuePort } from "@/lib/whatsapp/queue";
import type { WaRepository } from "@/lib/whatsapp/repository";
import { MIDIAS_POR_VEZ, PRECOS_MIDIA } from "./limites";
import { lerMidias, tipoDeLeitura, type DepsLeitura, type Leitura, type MidiaPendente } from "./ler";

export interface MidiaWorkerDeps {
  repo: WaRepository;
  queue: WaQueuePort;
  app?: PrismaClient;
  system?: PrismaClient;
  env?: Record<string, string | undefined>;
  /** Cliente do gateway (testes). */
  connectorFor?: PainelDeps["connectorFor"];
  /** Troca a leitura (testes): transcritor, descritor, baixar. */
  sobrescrever?: Partial<Pick<DepsLeitura, "transcrever" | "descrever" | "baixar" | "chave">>;
  now?: Date;
}

/** Mídias do contato ainda não lidas, das últimas 24h, da mais nova pra mais velha. */
export async function midiasPendentes(
  ctx: { userId: string; workspaceId: string },
  conversationId: string,
  now: Date,
  app: PrismaClient
): Promise<MidiaPendente[]> {
  const rows = await withRls(
    ctx,
    (tx) =>
      tx.waMessage.findMany({
        where: {
          conversationId,
          workspaceId: ctx.workspaceId,
          fromMe: false,
          revokedAt: null,
          mediaTextStatus: null,
          type: { in: ["audio", "image", "document"] },
          sentAt: { gte: new Date(now.getTime() - 24 * 3600 * 1000) },
        },
        orderBy: { sentAt: "desc" },
        take: 10,
        select: { id: true, type: true, mediaMime: true, mediaFilename: true, body: true },
      }),
    app
  );
  return rows
    .map((r) => ({ id: r.id, type: r.type, mime: r.mediaMime, filename: r.mediaFilename, legenda: r.body }))
    .filter((m) => tipoDeLeitura(m) !== null)
    .slice(0, MIDIAS_POR_VEZ);
}

export async function salvarLeitura(ctx: { userId: string; workspaceId: string }, leitura: Leitura, app: PrismaClient): Promise<void> {
  await withRls(
    ctx,
    (tx) =>
      tx.waMessage.updateMany({
        where: { id: leitura.messageId, workspaceId: ctx.workspaceId },
        data: { mediaText: leitura.texto, mediaTextKind: leitura.kind, mediaTextStatus: leitura.status },
      }),
    app
  );
}

/** Lê as mídias novas da conversa do job. Nunca joga erro (o agente roda de qualquer jeito). */
export async function lerMidiasDoJob(job: WaAgentJob, deps: MidiaWorkerDeps): Promise<Array<Pick<Leitura, "kind" | "status">>> {
  try {
    if (job.kind !== "inbound") return [];
    const now = deps.now ?? new Date();
    const app = deps.app ?? getAppPrisma();
    const system = deps.system ?? getPrisma();
    const ctx = { userId: job.ownerUserId, workspaceId: job.workspaceId };
    const store = storeFor(job.ownerUserId, job.workspaceId, { ...deps, app, system });
    const contexto = await store.carregarContexto(job.conversationId);
    if (!contexto || contexto.contact.isGroup) return [];
    if (resolverModo(contexto, now).modo === "OFF") return [];
    const ultima = [...contexto.historico].reverse().find((m) => !m.fromMe);
    if (!janelaAberta(ultima?.sentAt ?? null, now)) return [];
    const configs = await store.configAgentes(job.ownerUserId, contexto.session.id);
    const ativo = configs.find((c) => c.ativo);
    if (!ativo) return [];

    const pendentes = await midiasPendentes(ctx, job.conversationId, now, app);
    if (!pendentes.length) return [];

    const settings = await getAiSettings(system);
    // Preços dos modelos de transcrição entram por baixo da tabela do /admin.
    const settingsMidia = { ...settings, prices: { ...precosAdmin(), ...settings.prices } };
    const painel: PainelDeps = { repo: deps.repo, queue: deps.queue, app, system, env: deps.env, connectorFor: deps.connectorFor };
    const limites = { tetoUsuarioUsd: settings.dailyCapUserUsd, tetoWorkspaceUsd: settings.dailyCapWorkspaceUsd };

    const leitura: DepsLeitura = {
      baixar: async (id) => {
        try {
          const m = await messageMedia(ctx, id, painel);
          return { bytes: m.bytes, contentType: m.inline ? m.contentType : null };
        } catch {
          return null;
        }
      },
      salvar: (l) => salvarLeitura(ctx, l, app),
      chave: async (provider) => (await getAiCredential(provider, system))?.apiKey ?? null,
      provedorVisao: ativo.provider,
      cabeNoTeto: async (custo) => {
        const r = await conferirTeto(
          store,
          {
            ownerUserId: job.ownerUserId,
            workspaceId: job.workspaceId,
            dailyCap: Number.MAX_SAFE_INTEGER,
            custoPrevistoUsdMicro: custo,
            now,
            timeZone: contexto.profile?.timeZone,
          },
          limites
        );
        return r.ok;
      },
      registrarUso: async (u) => {
        await recordAiUsage(
          {
            ownerUserId: job.ownerUserId,
            workspaceId: job.workspaceId,
            kind: "midia",
            agent: "midia",
            provider: u.provider,
            model: u.modelo,
            contactId: contexto.contact.id,
            conversationId: job.conversationId,
            tokensIn: u.uso.tokensIn,
            tokensOut: u.uso.tokensOut,
            blocked: u.bloqueado,
            refId: u.messageId,
          },
          { base: system, settings: settingsMidia }
        );
      },
      precos: precosDaPlataforma(settings.prices),
      ...deps.sobrescrever,
    };
    const r = await lerMidias(pendentes, leitura);
    return r.map(({ kind, status }) => ({ kind, status }));
  } catch {
    // Mensagem fixa, sem conteúdo: a leitura de mídia nunca trava o agente.
    console.error("[WA Midia] não deu pra ler a mídia dessa conversa");
    return [];
  }
}

function precosAdmin() {
  return Object.fromEntries(
    Object.entries(PRECOS_MIDIA).map(([modelo, p]) => [
      modelo,
      { provider: p.provider, input: p.entrada, output: p.saida, cacheRead: p.cacheLeitura, cacheWrite: p.cacheEscrita },
    ])
  );
}
