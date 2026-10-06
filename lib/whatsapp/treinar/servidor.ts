/**
 * Dependências de verdade do "Treinar com um documento": chave, modelo, teto e
 * preços do /admin (lib/ai), gasto em Gastos de IA (kind "treino"). Só no servidor.
 */
import { getAgentModelConfig, getAiCredential, getAiSettings } from "@/lib/ai/credentials";
import { checkDailyCap, recordAiUsage } from "@/lib/ai/usage";
import { precosDaPlataforma } from "@/lib/whatsapp/agentes/modelos";
import { chamarModelo } from "@/lib/whatsapp/agentes/provedores";
import type { DepsTreino } from "./treinar";

export async function depsTreinoDoAdmin(ctx: { userId: string; workspaceId: string }): Promise<DepsTreino> {
  const settings = await getAiSettings();
  return {
    chamar: chamarModelo,
    // Ler um documento inteiro e organizar tudo é o "caso difícil": modelo maior do agente de qualificação.
    modelo: async () => {
      const cfg = await getAgentModelConfig("qualificacao");
      return { provider: cfg.provider, model: cfg.hardModel || cfg.model };
    },
    chave: async (provider) => (await getAiCredential(provider))?.apiKey ?? null,
    precos: precosDaPlataforma(settings.prices),
    conferirTeto: async (custo) => {
      const r = await checkDailyCap({ ownerUserId: ctx.userId, workspaceId: ctx.workspaceId, expectedCostMicroUsd: custo }, { settings });
      return r.ok ? { ok: true } : { ok: false, motivo: r.reason };
    },
    registrarUso: async (u) => {
      await recordAiUsage(
        {
          ownerUserId: ctx.userId,
          workspaceId: ctx.workspaceId,
          kind: "treino",
          agent: null,
          provider: u.provider,
          model: u.modelo,
          tokensIn: u.uso.tokensIn,
          tokensOut: u.uso.tokensOut,
          cacheRead: u.uso.cacheRead,
          cacheWrite: u.uso.cacheWrite,
          blocked: u.bloqueado,
        },
        { settings }
      );
    },
  };
}
