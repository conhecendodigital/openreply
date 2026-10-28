/**
 * Banco e rede do vendedor automático: tudo que o motor (motor.ts) recebe por `deps`.
 * Uma conversa por vez, nunca em paralelo.
 */
import { prisma } from "@/lib/db/client";
import { getAgentModelConfig, getAiCredential, getAiSettings } from "@/lib/ai/credentials";
import { recordAiUsage } from "@/lib/ai/usage";
import { AUTO_TAGS, addTag, recordEvent } from "@/lib/contacts/record";
import { createDraft } from "@/lib/drafts/drafts";
import { lastMessages } from "@/lib/inbox/context";
import { isWindowClosedError } from "@/lib/messaging/window";
import { sendDmParts } from "@/lib/messaging/send-parts";
import { startTakeover } from "@/lib/messaging/takeover";
import { getUserProfileMetrics, sendDirectMessage, sendTypingIndicator } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { sendTracked } from "@/lib/meta/send";
import { withSystemRole } from "@/lib/db/rls";
import { custoUsdMicro, precosDaPlataforma } from "@/lib/whatsapp/agentes/modelos";
import { chamarModelo } from "@/lib/whatsapp/agentes/provedores";
import { conferirTeto, inicioDoDia, limitesDoAmbiente } from "@/lib/whatsapp/agentes/teto";
import type { AgentStore } from "@/lib/whatsapp/agentes/types";
import { defaultConfig, type VendedorConfig } from "./config";
import type { DepsVendedor, Outcome, RespostaIa } from "./motor";
import { MAX_TOKENS_VENDEDOR } from "./prompt";
import { MAX_CONSULTAS_PERFIL_POR_RODADA, montarCartao, perfilVencido } from "./pessoa";
import type { Contagens } from "./regras";
import { ABERTURAS_GUARDADAS, aberturaDe, type ExemploVendedor } from "./conversa";
import { lerFicha, type Ficha, type Fonte } from "./ficha";

const HORA_MS = 3_600_000;
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function carregarConfig(instagramAccountId: string, workspaceId: string): Promise<VendedorConfig> {
  const row = await prisma.vendedorIgConfig.findUnique({ where: { instagramAccountId } });
  const base = defaultConfig(instagramAccountId, workspaceId);
  if (!row) return base;
  return {
    ...base,
    enabled: row.enabled,
    offerFacts: row.offerFacts,
    socialProof: row.socialProof,
    licoes: row.licoes,
    minGapSeconds: row.minGapSeconds,
    maxPerHour: row.maxPerHour,
    maxPerDay: row.maxPerDay,
    maxPerPersonDay: row.maxPerPersonDay,
    replyDelayMinSec: row.replyDelayMinSec,
    replyDelayMaxSec: row.replyDelayMaxSec,
    quietStart: row.quietStart,
    quietEnd: row.quietEnd,
  };
}

export type ContaIg = { id: string; instagramId: string; workspaceId: string; accessToken: string; ownerId: string };
export type ContatoIg = {
  id: string;
  workspaceId: string;
  igUserId: string;
  username: string | null;
  name: string | null;
  notes: string | null;
};

/** Teto de gasto de IA (mesmo do WhatsApp: US$ 1 por usuário e US$ 3 por workspace por dia, do /admin). */
function storeDeGasto(): Pick<AgentStore, "gastoDoDia"> {
  return {
    async gastoDoDia(escopo, desde) {
      if ("sessionId" in escopo) return { custoUsdMicro: 0, respostas: 0, autoEnvios: 0 };
      const where = "ownerUserId" in escopo ? { ownerUserId: escopo.ownerUserId } : { workspaceId: escopo.workspaceId };
      const soma = await withSystemRole((tx) => tx.waAiUsage.aggregate({ where: { ...where, createdAt: { gte: desde } }, _sum: { costMicroUsd: true } }));
      return { custoUsdMicro: Number(soma._sum.costMicroUsd ?? 0), respostas: 0, autoEnvios: 0 };
    },
  };
}

export type ContextoRodada = { consultasPerfil: number; sleep?: (ms: number) => Promise<void> };

export function criarDeps(conta: ContaIg, contato: ContatoIg, config: VendedorConfig, rodada: ContextoRodada): DepsVendedor {
  const agora = () => new Date();
  const sleep = rodada.sleep ?? realSleep;
  let inboundMid: string | null = null;
  const token = () => decryptToken(conta.accessToken);
  let seguidoresOficiais: number | null = null;

  return {
    agora,
    config,
    async contato() {
      const c = await prisma.contact.findUniqueOrThrow({
        where: { id: contato.id },
        select: { lastInboundAt: true, humanTakeover: true, humanTakeoverUntil: true, broadcastOptOutAt: true },
      });
      return c;
    },
    mensagens: () => lastMessages(conta.instagramId, contato.igUserId),
    async contagens(): Promise<Contagens> {
      const now = agora();
      const dia = inicioDoDia(now);
      const contaram = { instagramAccountId: conta.id, outcome: { in: ["sent", "sending"] } };
      const [hora, doDia, pessoaDia, ultimo] = await Promise.all([
        prisma.vendedorIgLog.count({ where: { ...contaram, createdAt: { gte: new Date(now.getTime() - HORA_MS) } } }),
        prisma.vendedorIgLog.count({ where: { ...contaram, createdAt: { gte: dia } } }),
        prisma.vendedorIgLog.count({ where: { ...contaram, contactId: contato.id, createdAt: { gte: dia } } }),
        prisma.vendedorIgLog.findFirst({ where: contaram, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      ]);
      return { hora, dia: doDia, pessoaDia, ultimoEnvioEm: ultimo?.createdAt ?? null };
    },
    async temRascunhoPendente() {
      return (await prisma.draftReply.count({ where: { contactId: contato.id, status: "PENDING" } })) > 0;
    },
    async paradoAntes() {
      return (await prisma.vendedorIgLog.count({ where: { contactId: contato.id, outcome: "stopped" } })) > 0;
    },
    async reservar(mid) {
      inboundMid = mid;
      try {
        const row = await prisma.vendedorIgLog.create({
          data: { workspaceId: conta.workspaceId, instagramAccountId: conta.id, contactId: contato.id, inboundMid: mid, outcome: "sending", reason: "em andamento" },
          select: { id: true },
        });
        return row.id;
      } catch (e) {
        if ((e as { code?: string })?.code === "P2002") return null;
        throw e;
      }
    },
    async finalizar(logId, d) {
      await prisma.vendedorIgLog.update({
        where: { id: logId },
        data: {
          outcome: d.outcome satisfies Outcome,
          reason: d.reason.slice(0, 500),
          text: d.text ?? null,
          parts: d.parts ?? 0,
          mids: d.mids ?? [],
          draftId: d.draftId ?? null,
          model: d.model ?? null,
          costMicroUsd: Math.min(2_000_000_000, d.costMicroUsd ?? 0),
        },
      });
    },
    async podeGastar() {
      const limites = limitesDoAmbiente();
      const r = await conferirTeto(
        storeDeGasto(),
        { ownerUserId: conta.ownerId, workspaceId: conta.workspaceId, dailyCap: 100_000, custoPrevistoUsdMicro: 20_000, now: agora() },
        limites
      );
      return r.ok;
    },
    async cartao() {
      const [c, tags, comentarios, leads, cache] = await Promise.all([
        prisma.contact.findUniqueOrThrow({ where: { id: contato.id }, select: { name: true, username: true, notes: true, followsBusiness: true } }),
        prisma.contactTag.findMany({ where: { contactId: contato.id }, select: { name: true }, orderBy: { createdAt: "asc" }, take: 12 }),
        prisma.contactEvent.findMany({ where: { contactId: contato.id, type: "COMMENT" }, select: { text: true }, orderBy: { occurredAt: "desc" }, take: 3 }),
        prisma.funnelLead.findMany({ where: { contactId: contato.id }, select: { answers: true }, orderBy: { createdAt: "desc" }, take: 1 }),
        prisma.vendedorIgPerfil.findUnique({ where: { contactId: contato.id } }),
      ]);
      let perfil = cache;
      // Dado oficial do perfil (User Profile API), com cache de 24 h e no máximo N consultas por rodada.
      if (perfilVencido(cache?.fetchedAt, agora()) && rodada.consultasPerfil < MAX_CONSULTAS_PERFIL_POR_RODADA) {
        rodada.consultasPerfil++;
        const m = await getUserProfileMetrics(token(), contato.igUserId);
        const dados = { followerCount: m.followerCount, followsUs: m.followsBusiness, status: m.ok ? "ok" : "denied", fetchedAt: agora() };
        perfil = await prisma.vendedorIgPerfil.upsert({ where: { contactId: contato.id }, create: { contactId: contato.id, ...dados }, update: dados });
      }
      const quiz: Record<string, string> = {};
      const answers = leads[0]?.answers as Record<string, unknown> | undefined;
      for (const [k, v] of Object.entries(answers ?? {})) if (typeof v === "string") quiz[k] = v;
      seguidoresOficiais = perfil?.status === "ok" ? perfil.followerCount : null;
      return montarCartao({
        nome: c.name,
        username: c.username,
        etiquetas: tags.map((t) => t.name),
        anotacoes: c.notes,
        comentarios: comentarios.map((e) => e.text ?? "").filter(Boolean),
        quiz,
        seguidores: perfil?.status === "ok" ? perfil.followerCount : null,
        seguePraNos: perfil?.status === "ok" ? (perfil.followsUs ?? c.followsBusiness) : c.followsBusiness,
      });
    },
    nomeDaPessoa: () => contato.name,
    async ficha() {
      const row = await prisma.vendedorIgFicha.findUnique({ where: { contactId: contato.id } });
      return row ? lerFicha(row.campos, row.estagio) : null;
    },
    async fontesDaPessoa() {
      const [comentarios, leads] = await Promise.all([
        prisma.contactEvent.findMany({ where: { contactId: contato.id, type: "COMMENT" }, select: { text: true }, orderBy: { occurredAt: "desc" }, take: 5 }),
        prisma.funnelLead.findMany({ where: { contactId: contato.id }, select: { answers: true }, orderBy: { createdAt: "desc" }, take: 1 }),
      ]);
      const fontes: Fonte[] = comentarios.filter((e) => e.text).map((e) => ({ origem: "comentario" as const, texto: e.text as string }));
      for (const v of Object.values((leads[0]?.answers as Record<string, unknown> | undefined) ?? {})) if (typeof v === "string") fontes.push({ origem: "quiz", texto: v });
      return fontes;
    },
    async salvarFicha(f: Ficha) {
      const data = { campos: f.campos as object, estagio: f.estagio };
      await prisma.vendedorIgFicha.upsert({
        where: { contactId: contato.id },
        create: { contactId: contato.id, workspaceId: conta.workspaceId, instagramAccountId: conta.id, ...data },
        update: data,
      });
    },
    async seguidores() {
      return seguidoresOficiais;
    },
    async aberturasRecentes() {
      const rows = await prisma.vendedorIgLog.findMany({
        where: { instagramAccountId: conta.id, outcome: { in: ["sent", "draft"] }, text: { not: null } },
        orderBy: { createdAt: "desc" },
        take: ABERTURAS_GUARDADAS,
        select: { text: true },
      });
      return rows.map((r) => aberturaDe(r.text ?? "")).filter(Boolean);
    },
    async textosRecentes() {
      const rows = await prisma.vendedorIgLog.findMany({
        where: { instagramAccountId: conta.id, outcome: { in: ["sent", "draft"] }, text: { not: null } },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { text: true },
      });
      return rows.map((r) => r.text ?? "").filter(Boolean);
    },
    async exemplos(): Promise<ExemploVendedor[]> {
      const rows = await prisma.vendedorIgExemplo.findMany({
        where: { instagramAccountId: conta.id },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { pergunta: true, rascunho: true, resposta: true, createdAt: true },
      });
      return rows;
    },
    async perguntarIa(input): Promise<RespostaIa> {
      const cfg = await getAgentModelConfig("atendimento");
      const cred = await getAiCredential(cfg.provider);
      if (!cred) throw new (await import("@/lib/whatsapp/agentes/provedores")).ErroModelo("chave_invalida", null);
      const modelo = input.dificil ? cfg.hardModel : cfg.model;
      const r = await chamarModelo({
        provider: cfg.provider,
        modelo,
        apiKey: cred.apiKey,
        sistemaFixo: input.sistemaFixo,
        sistemaVariavel: input.sistemaVariavel,
        mensagens: [{ role: "user", content: input.mensagem || "(mensagem sem texto)" }],
        maxTokens: MAX_TOKENS_VENDEDOR,
        chaveCache: `vendedor-ig:${conta.id}`,
      });
      const settings = await getAiSettings();
      const custo = custoUsdMicro(modelo, r.uso, precosDaPlataforma(settings.prices));
      await recordAiUsage(
        {
          ownerUserId: conta.ownerId,
          workspaceId: conta.workspaceId,
          kind: "vendedor_ig",
          agent: "atendimento",
          provider: cfg.provider,
          model: modelo,
          contactId: contato.id,
          tokensIn: r.uso.tokensIn,
          tokensOut: r.uso.tokensOut,
          cacheRead: r.uso.cacheRead,
          cacheWrite: r.uso.cacheWrite,
          refId: inboundMid,
        },
        { settings }
      );
      return { texto: r.texto, modelo, custoMicro: custo };
    },
    async enviar(partes, logId) {
      const accessToken = token();
      const sent = await sendDmParts({
        parts: partes,
        sleep,
        typing: () => sendTypingIndicator(accessToken, conta.instagramId, contato.igUserId, "typing_on"),
        send: (texto) =>
          sendTracked(
            { workspaceId: conta.workspaceId, instagramAccountId: conta.id, contactIgUserId: contato.igUserId, origin: "vendedor_auto", refId: logId, text: texto },
            (options) => sendDirectMessage(accessToken, conta.instagramId, contato.igUserId, texto, options)
          ),
      });
      if (sent.mids.length > 0) {
        const at = agora();
        await prisma.contact.updateMany({ where: { id: contato.id, OR: [{ lastOutboundAt: null }, { lastOutboundAt: { lt: at } }] }, data: { lastOutboundAt: at } }).catch(() => undefined);
        await recordEvent({ id: contato.id, workspaceId: conta.workspaceId }, {
          type: "DRAFT_SENT",
          refId: logId,
          occurredAt: at,
          text: partes.join(" / "),
          meta: { origin: "vendedor_auto", parts: sent.mids.length, mids: sent.mids },
        }).catch(() => false);
      }
      return {
        mids: sent.mids,
        falha: sent.failure
          ? {
              indice: sent.failure.index,
              mensagem: sent.failure.error instanceof Error ? sent.failure.error.message : "falha no envio",
              janelaFechada: isWindowClosedError(sent.failure.error),
            }
          : null,
      };
    },
    async criarRascunho(texto, motivo) {
      const r = await createDraft({
        workspaceId: conta.workspaceId,
        contactId: contato.id,
        text: texto,
        reason: motivo,
        origin: "vendedor",
        basedOnMid: inboundMid,
        createdBy: "vendedor_auto",
      });
      return r.ok ? { ok: true, id: r.draft.id } : { ok: false, erro: r.error };
    },
    async registrarParada(mid, texto) {
      const at = agora();
      await prisma.contact.updateMany({ where: { id: contato.id, broadcastOptOutAt: null }, data: { broadcastOptOutAt: at } });
      const ref = { id: contato.id, workspaceId: conta.workspaceId };
      await addTag(ref, AUTO_TAGS.optedOut, "auto", at).catch(() => false);
      await recordEvent(ref, { type: "OPT_OUT", refId: mid, occurredAt: at, text: (texto ?? "").slice(0, 60) }).catch(() => false);
    },
    async chamarDono(motivo) {
      // O motivo fica no registro (VendedorIgLog.reason); aqui só pausa o vendedor e as automações nessa pessoa.
      void motivo;
      await startTakeover({ contactId: contato.id, by: "vendedor_auto", reason: "flow" });
    },
  };
}
