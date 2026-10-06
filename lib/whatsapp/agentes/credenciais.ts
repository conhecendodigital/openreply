/**
 * Chave de API de IA do dono (Anthropic ou OpenAI).
 *
 * Guardada com a mesma criptografia AES-256-GCM que o Lead Engine já usa nos
 * tokens da Meta (lib/meta/oauth.ts, ENCRYPTION_KEY). Depois de salva, a chave
 * nunca volta: a tela e a API só recebem provedor, 4 últimos caracteres, teto e
 * datas. Só o motor abre a chave, na hora de chamar o modelo.
 */
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import type { AgentStore, AiCredentialPublica, AiCredentialRecord, IaProvider } from "./types";

export const DAILY_CAP_PADRAO = 300;

export type ErroChave = "formato_invalido" | "provedor_invalido";

export function validarFormatoChave(provider: IaProvider, chave: string): boolean {
  const k = chave.trim();
  if (k.length < 20 || k.length > 300 || /\s/.test(k)) return false;
  if (provider === "anthropic") return k.startsWith("sk-ant-");
  if (provider === "openai") return k.startsWith("sk-") && !k.startsWith("sk-ant-");
  return false;
}

export function paraPublica(rec: AiCredentialRecord): AiCredentialPublica {
  // Lista explícita de campos: um campo novo no registro não vaza por engano.
  return {
    id: rec.id,
    ownerUserId: rec.ownerUserId,
    provider: rec.provider,
    keyLast4: rec.keyLast4,
    dailyCap: rec.dailyCap,
    createdAt: rec.createdAt,
    revokedAt: rec.revokedAt,
  };
}

export async function salvarChave(
  store: AgentStore,
  input: { ownerUserId: string; provider: IaProvider; chave: string; dailyCap?: number }
): Promise<{ ok: true; credencial: AiCredentialPublica } | { ok: false; erro: ErroChave; mensagem: string }> {
  if (input.provider !== "anthropic" && input.provider !== "openai") {
    return { ok: false, erro: "provedor_invalido", mensagem: "Escolha Claude (Anthropic) ou OpenAI." };
  }
  const chave = input.chave.trim();
  if (!validarFormatoChave(input.provider, chave)) {
    return {
      ok: false,
      erro: "formato_invalido",
      mensagem:
        input.provider === "anthropic"
          ? "Essa chave não parece da Anthropic. Ela começa com sk-ant-."
          : "Essa chave não parece da OpenAI. Ela começa com sk-.",
    };
  }
  const dailyCap = Math.min(5000, Math.max(1, Math.round(input.dailyCap ?? DAILY_CAP_PADRAO)));
  const rec = await store.salvarCredencial({
    ownerUserId: input.ownerUserId,
    provider: input.provider,
    keyEnc: encryptToken(chave),
    keyLast4: chave.slice(-4),
    dailyCap,
  });
  return { ok: true, credencial: paraPublica(rec) };
}

export async function listarChaves(store: AgentStore, ownerUserId: string): Promise<AiCredentialPublica[]> {
  return (await store.listarCredenciais(ownerUserId)).map(paraPublica);
}

/** Só pro motor. Nunca devolver isso numa rota. */
export function abrirChave(rec: AiCredentialRecord): string {
  return decryptToken(rec.keyEnc);
}
