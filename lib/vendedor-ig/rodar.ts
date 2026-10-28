/**
 * Rodada do vendedor automático (chamada pelo cron a cada minuto). Fila GLOBAL e serial:
 * uma conversa por vez, nunca em paralelo, e depois de enviar numa conversa espera
 * `minGapSeconds` (padrão 5 s) antes de atender outra. Limites por hora, dia e pessoa vêm da config.
 */
import { prisma } from "@/lib/db/client";
import { carregarConfig, criarDeps, type ContaIg } from "./dados";
import { vendedorDesligadoPorEnv } from "./config";
import { processarConversa, type Resultado } from "./motor";
import { buscarCandidatosRetomada, MAX_RETOMADAS_POR_RODADA } from "./retomada";
import { inicioDoDia } from "@/lib/whatsapp/agentes/teto";

export const MAX_ENVIOS_POR_RODADA = 5;
export const MAX_CANDIDATOS_POR_CONTA = 40;
const DIA_MS = 24 * 3_600_000;

let rodando = false;

export type ResumoRodada = {
  desligado?: "env" | "ocupado";
  contas: number;
  avaliadas: number;
  enviadas: number;
  rascunhos: number;
  puladas: number;
  erros: number;
  /** Das enviadas, quantas foram retomadas. */
  retomadas: number;
};

export async function rodarVendedorIg(opts: { now?: Date; sleep?: (ms: number) => Promise<void> } = {}): Promise<ResumoRodada> {
  const vazio: ResumoRodada = { contas: 0, avaliadas: 0, enviadas: 0, rascunhos: 0, puladas: 0, erros: 0, retomadas: 0 };
  if (vendedorDesligadoPorEnv()) return { ...vazio, desligado: "env" };
  if (rodando) return { ...vazio, desligado: "ocupado" };
  rodando = true;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  try {
    const now = opts.now ?? new Date();
    const configs = await prisma.vendedorIgConfig.findMany({
      where: { enabled: true, instagramAccount: { status: "ACTIVE" } },
      select: { instagramAccountId: true },
    });
    const resumo = { ...vazio, contas: configs.length };
    const rodada = { consultasPerfil: 0, sleep };
    let envios = 0;
    for (const { instagramAccountId } of configs) {
      const acc = await prisma.instagramAccount.findUnique({
        where: { id: instagramAccountId },
        select: { id: true, instagramId: true, workspaceId: true, accessToken: true, workspace: { select: { ownerId: true } } },
      });
      if (!acc) continue;
      const conta: ContaIg = { id: acc.id, instagramId: acc.instagramId, workspaceId: acc.workspaceId, accessToken: acc.accessToken, ownerId: acc.workspace.ownerId };
      const config = await carregarConfig(acc.id, acc.workspaceId);
      if (!config.enabled) continue;
      const candidatos = await prisma.contact.findMany({
        where: { instagramAccountId: acc.id, lastInboundAt: { gte: new Date(now.getTime() - DIA_MS) } },
        orderBy: { lastInboundAt: "asc" },
        take: MAX_CANDIDATOS_POR_CONTA,
        select: { id: true, workspaceId: true, igUserId: true, username: true, name: true, notes: true, lastInboundAt: true, lastOutboundAt: true },
      });
      for (const c of candidatos) {
        if (envios >= MAX_ENVIOS_POR_RODADA) break;
        // Só quem falou depois da nossa última mensagem.
        if (c.lastOutboundAt && c.lastInboundAt && c.lastOutboundAt >= c.lastInboundAt) continue;
        // Chave de emergência também no meio da rodada.
        if (vendedorDesligadoPorEnv()) return { ...resumo, desligado: "env" };
        let r: Resultado;
        try {
          r = await processarConversa(criarDeps(conta, c, config, rodada));
        } catch (e) {
          console.warn("[VendedorIG] conversa falhou:", e instanceof Error ? e.message.slice(0, 200) : "erro");
          resumo.erros++;
          continue;
        }
        if (r.outcome === "esperar") continue;
        resumo.avaliadas++;
        if (r.outcome === "sent") {
          resumo.enviadas++;
          envios++;
          // Fila: espera antes de atender outra conversa.
          await sleep(config.minGapSeconds * 1000);
        } else if (r.outcome === "draft") resumo.rascunhos++;
        else if (r.outcome === "error") resumo.erros++;
        else resumo.puladas++;
      }

      // Segunda passada (devagar): retomada de quem recebeu o fluxo e não respondeu. Interruptor próprio.
      if (config.retomadaEnabled && envios < MAX_ENVIOS_POR_RODADA) {
        let retomadas = 0;
        const quem = await buscarCandidatosRetomada(prisma as never, acc.id, config, now);
        for (const c of quem) {
          if (retomadas >= MAX_RETOMADAS_POR_RODADA || envios >= MAX_ENVIOS_POR_RODADA) break;
          if (vendedorDesligadoPorEnv()) return { ...resumo, desligado: "env" };
          let r: Resultado;
          try {
            r = await processarConversa(criarDeps(conta, c, config, rodada), { modo: "retomada" });
          } catch (e) {
            console.warn("[VendedorIG] retomada falhou:", e instanceof Error ? e.message.slice(0, 200) : "erro");
            resumo.erros++;
            continue;
          }
          if (r.outcome === "esperar") continue;
          resumo.avaliadas++;
          if (r.outcome === "sent") {
            resumo.enviadas++;
            resumo.retomadas++;
            retomadas++;
            envios++;
            await sleep(config.minGapSeconds * 1000);
          } else if (r.outcome === "draft") resumo.rascunhos++;
          else if (r.outcome === "error") resumo.erros++;
          else resumo.puladas++;
        }
      }
    }
    return resumo;
  } finally {
    rodando = false;
  }
}

export type ResumoDiario = {
  dia: string;
  enviadas: number;
  mensagensEnviadas: number;
  rascunhos: number;
  puladas: number;
  paradas: number;
  erros: number;
  gastoUsd: number;
  porMotivo: { motivo: string; total: number }[];
};

/** Resumo do dia (fuso de São Paulo): o que o vendedor fez sozinho e por quê. */
export async function resumoDoDia(instagramAccountId: string, now: Date = new Date()): Promise<ResumoDiario> {
  const desde = inicioDoDia(now);
  const rows = await prisma.vendedorIgLog.findMany({
    where: { instagramAccountId, createdAt: { gte: desde } },
    select: { outcome: true, reason: true, parts: true, costMicroUsd: true },
  });
  const porMotivo = new Map<string, number>();
  const r: ResumoDiario = { dia: desde.toISOString(), enviadas: 0, mensagensEnviadas: 0, rascunhos: 0, puladas: 0, paradas: 0, erros: 0, gastoUsd: 0, porMotivo: [] };
  for (const row of rows) {
    if (row.outcome === "sent") {
      r.enviadas++;
      r.mensagensEnviadas += row.parts;
    } else if (row.outcome === "draft") r.rascunhos++;
    else if (row.outcome === "skipped") r.puladas++;
    else if (row.outcome === "stopped") r.paradas++;
    else if (row.outcome === "error") r.erros++;
    r.gastoUsd += row.costMicroUsd / 1_000_000;
    const k = `${row.outcome}: ${row.reason}`.slice(0, 120);
    porMotivo.set(k, (porMotivo.get(k) ?? 0) + 1);
  }
  r.gastoUsd = Math.round(r.gastoUsd * 10000) / 10000;
  r.porMotivo = [...porMotivo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([motivo, total]) => ({ motivo, total }));
  return r;
}
