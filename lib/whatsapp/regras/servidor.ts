/**
 * IA do /admin pras telas das regras ("Gerar sugestões com IA" e "Testar o
 * agente"): chave, modelo do agente de qualificação, teto do dia e gasto em
 * Gastos de IA. Só no servidor.
 */
import { getAgentModelConfig, getAiCredential, getAiSettings } from "@/lib/ai/credentials";
import { checkDailyCap, recordAiUsage } from "@/lib/ai/usage";
import { precosDaPlataforma, type Preco } from "@/lib/whatsapp/agentes/modelos";
import { chamarModelo, type ChamarModelo } from "@/lib/whatsapp/agentes/provedores";
import type { IaProvider, Uso } from "@/lib/whatsapp/agentes/types";

export interface DepsIa {
  chamar: ChamarModelo;
  /** Provedor e modelo do agente de qualificação (o padrão, ou o "difícil"). */
  modelo: (dificil: boolean) => Promise<{ provider: IaProvider; model: string }>;
  chave: (provider: IaProvider) => Promise<string | null>;
  precos: Record<string, Preco>;
  conferirTeto: (custoPrevistoUsdMicro: number) => Promise<boolean>;
  registrarUso: (u: { provider: IaProvider; modelo: string; uso: Uso; bloqueado?: boolean }) => Promise<void>;
}

export async function depsIaDoAdmin(ctx: { userId: string; workspaceId: string }, kind: "teste" | "aprendizado"): Promise<DepsIa> {
  const settings = await getAiSettings();
  return {
    chamar: chamarModelo,
    modelo: async (dificil) => {
      const cfg = await getAgentModelConfig("qualificacao");
      return { provider: cfg.provider, model: dificil ? cfg.hardModel || cfg.model : cfg.model };
    },
    chave: async (provider) => (await getAiCredential(provider))?.apiKey ?? null,
    precos: precosDaPlataforma(settings.prices),
    conferirTeto: async (custo) => (await checkDailyCap({ ownerUserId: ctx.userId, workspaceId: ctx.workspaceId, expectedCostMicroUsd: custo }, { settings })).ok,
    registrarUso: async (u) => {
      await recordAiUsage(
        {
          ownerUserId: ctx.userId,
          workspaceId: ctx.workspaceId,
          kind,
          agent: null,
          provider: u.provider,
          model: u.modelo,
          tokensIn: u.uso.tokensIn,
          tokensOut: u.uso.tokensOut,
          cacheRead: u.uso.cacheRead,
          cacheWrite: u.uso.cacheWrite,
          blocked: Boolean(u.bloqueado),
        },
        { settings }
      );
    },
  };
}
