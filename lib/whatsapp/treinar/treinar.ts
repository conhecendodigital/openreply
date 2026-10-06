/**
 * "Treinar com um documento" (06/10/2026, pedido do dono: "queria lançar um
 * PDF desse e o agente já ser todo treinado sem precisar preencher nada, só
 * corrigir").
 *
 * Texto do documento -> IA (chave e modelo do /admin, teto conferido antes,
 * gasto registrado) -> JSON validado com zod -> rascunho da tela Agentes.
 *
 * NADA é salvo aqui: nem configuração, nem documento, nem o texto. O rascunho
 * volta pra tela e só vira configuração quando o dono clica em Salvar. Os
 * agentes e o modo do número não fazem parte do rascunho, então nada liga.
 * No log só vão códigos curtos, nunca o texto do documento.
 */
import { custoMaximoUsdMicro, custoUsdMicro, type Preco } from "@/lib/whatsapp/agentes/modelos";
import { ErroModelo, mensagemErro, type ChamarModelo, type MensagemChat } from "@/lib/whatsapp/agentes/provedores";
import type { IaProvider, Uso } from "@/lib/whatsapp/agentes/types";
import { MAX_TOKENS_TREINO, mensagemDeCorrecao, mensagemDoDocumento, SISTEMA_TREINO } from "./comando";
import { RespostaIaSchema, type RascunhoTreino, type RespostaIa } from "./esquema";
import { montarRascunho, type ArquivoTreino } from "./montar";

/** Treinos por pessoa por hora (cada um é uma chamada grande de IA). */
export const TREINO_RATE_LIMIT = { limit: 10, windowSeconds: 60 * 60 };

export interface DepsTreino {
  chamar: ChamarModelo;
  /** Provedor e modelo (o do caso difícil do agente de qualificação, no /admin). */
  modelo: () => Promise<{ provider: IaProvider; model: string }>;
  /** Chave aberta do provedor (/admin). null = sem chave. */
  chave: (provider: IaProvider) => Promise<string | null>;
  precos: Record<string, Preco>;
  /** Teto diário do usuário e do workspace, com o pior caso desta chamada. */
  conferirTeto: (custoPrevistoUsdMicro: number) => Promise<{ ok: true } | { ok: false; motivo: "teto_usuario" | "teto_workspace" }>;
  /** Registro em Gastos de IA (só tokens e custo, nunca texto). */
  registrarUso: (u: { provider: IaProvider; modelo: string; uso: Uso; custoUsdMicro: number; bloqueado: boolean }) => Promise<void>;
  timeoutMs?: number;
}

export type FalhaTreino = {
  ok: false;
  status: number;
  codigo: "no_ai_key" | "ai_cap" | "ai_error" | "ai_bad_output";
  mensagem: string;
};

const USO_ZERO: Uso = { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 };

/** Lê o JSON da resposta (aceita texto em volta ou cerca de código). */
export function lerJson(texto: string): unknown {
  const ini = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  if (ini < 0 || fim <= ini) return null;
  try {
    return JSON.parse(texto.slice(ini, fim + 1));
  } catch {
    return null;
  }
}

export function validarResposta(texto: string): { ok: true; resposta: RespostaIa } | { ok: false; problemas: string } {
  const json = lerJson(texto);
  if (json === null) return { ok: false, problemas: "não veio um JSON" };
  const r = RespostaIaSchema.safeParse(json);
  if (r.success) return { ok: true, resposta: r.data };
  return {
    ok: false,
    problemas: r.error.issues
      .slice(0, 8)
      .map((i) => `${i.path.join(".") || "raiz"}: ${i.message}`)
      .join("; "),
  };
}

export async function treinarComDocumento(arquivo: ArquivoTreino, deps: DepsTreino): Promise<{ ok: true; rascunho: RascunhoTreino } | FalhaTreino> {
  const { provider, model } = await deps.modelo();
  const apiKey = await deps.chave(provider);
  if (!apiKey) {
    return { ok: false, status: 409, codigo: "no_ai_key", mensagem: "There is no AI key in /admin > AI keys yet. Ask the admin to add one." };
  }

  const mensagens: MensagemChat[] = [{ role: "user", content: mensagemDoDocumento({ nomeArquivo: arquivo.nome, texto: arquivo.texto }) }];
  let problemas = "";
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const caracteres = SISTEMA_TREINO.length + mensagens.reduce((n, m) => n + m.content.length, 0);
    const previsto = custoMaximoUsdMicro(model, caracteres, MAX_TOKENS_TREINO, deps.precos);
    const teto = await deps.conferirTeto(previsto);
    if (!teto.ok) {
      await deps.registrarUso({ provider, modelo: model, uso: USO_ZERO, custoUsdMicro: 0, bloqueado: true });
      return {
        ok: false,
        status: 429,
        codigo: "ai_cap",
        mensagem:
          teto.motivo === "teto_usuario"
            ? "Your daily AI spending cap was reached. Try again tomorrow or ask the admin to raise it in /admin."
            : "The workspace daily AI spending cap was reached. Try again tomorrow or ask the admin to raise it in /admin.",
      };
    }

    let texto: string;
    try {
      const r = await deps.chamar({
        provider,
        modelo: model,
        apiKey,
        sistemaFixo: SISTEMA_TREINO,
        sistemaVariavel: "",
        mensagens,
        maxTokens: MAX_TOKENS_TREINO,
        timeoutMs: deps.timeoutMs ?? 180_000,
      });
      await deps.registrarUso({ provider, modelo: model, uso: r.uso, custoUsdMicro: custoUsdMicro(model, r.uso, deps.precos), bloqueado: false });
      texto = r.texto;
    } catch (error) {
      const codigo = error instanceof ErroModelo ? error.codigo : "rede";
      console.error(`[whatsapp/treinar] a IA falhou: ${codigo}`);
      return { ok: false, status: 502, codigo: "ai_error", mensagem: mensagemErro(codigo) };
    }

    const v = validarResposta(texto);
    if (v.ok) return { ok: true, rascunho: montarRascunho(v.resposta, arquivo) };
    problemas = v.problemas;
    mensagens.push({ role: "assistant", content: texto.slice(0, 40_000) || "{}" }, { role: "user", content: mensagemDeCorrecao(problemas) });
  }
  console.error("[whatsapp/treinar] a IA devolveu um JSON fora do formato duas vezes");
  return {
    ok: false,
    status: 502,
    codigo: "ai_bad_output",
    mensagem: "The AI could not organize this document now. Try again in a minute.",
  };
}
