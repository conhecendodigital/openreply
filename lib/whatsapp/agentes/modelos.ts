/**
 * Roteador de modelo e tabela de preço.
 *
 * Padrão barato (Claude Haiku 4.5 ou GPT-5 mini). Sonnet 5 só quando o Jev
 * fica incerto ou a conversa é difícil. Cada agente escolhe o provedor.
 *
 * Preços em dólar por 1 milhão de tokens (conferidos em 06/10/2026; confira de
 * novo nas páginas da Anthropic e da OpenAI antes de mudar o teto). Leitura de
 * cache custa 10% da entrada nos dois; escrita de cache na Anthropic, 125%.
 */
import type { AgenteConfig, IaProvider, Uso } from "./types";

export const MODELO_HAIKU = "claude-haiku-4-5-20251001";
export const MODELO_SONNET = "claude-sonnet-5";
export const MODELO_GPT_MINI = "gpt-5-mini";

export interface Preco {
  provider: IaProvider;
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
}

export const PRECOS: Record<string, Preco> = {
  [MODELO_HAIKU]: { provider: "anthropic", entrada: 1, saida: 5, cacheLeitura: 0.1, cacheEscrita: 1.25 },
  "claude-haiku-4-5": { provider: "anthropic", entrada: 1, saida: 5, cacheLeitura: 0.1, cacheEscrita: 1.25 },
  [MODELO_SONNET]: { provider: "anthropic", entrada: 2, saida: 10, cacheLeitura: 0.2, cacheEscrita: 2.5 },
  [MODELO_GPT_MINI]: { provider: "openai", entrada: 0.25, saida: 2, cacheLeitura: 0.025, cacheEscrita: 0.25 },
  "gpt-5": { provider: "openai", entrada: 1.25, saida: 10, cacheLeitura: 0.125, cacheEscrita: 1.25 },
};

/** Modelos que a tela pode oferecer. Qualquer outro é recusado (preço desconhecido quebra o teto). */
export function modeloConhecido(modelo: string, tabela: Record<string, Preco> = PRECOS): boolean {
  return Object.prototype.hasOwnProperty.call(tabela, modelo);
}

/**
 * Tabela de preços do /admin (lib/ai/catalog.ts, editável) no formato do motor.
 * Só conversa (anthropic e openai); TypeSafe/Jev fica fora.
 */
export function precosDaPlataforma(
  prices: Record<string, { provider: string; input: number; output: number; cacheRead: number; cacheWrite: number }>
): Record<string, Preco> {
  const out: Record<string, Preco> = {};
  for (const [modelo, p] of Object.entries(prices)) {
    if (p.provider !== "anthropic" && p.provider !== "openai") continue;
    out[modelo] = { provider: p.provider, entrada: p.input, saida: p.output, cacheLeitura: p.cacheRead, cacheEscrita: p.cacheWrite };
  }
  return Object.keys(out).length ? out : PRECOS;
}

export interface Escolha {
  provider: IaProvider;
  modelo: string;
  motivo: "padrao" | "dificil";
}

export function escolherModelo(
  config: AgenteConfig,
  sinais: { dificil: boolean; incerto: boolean },
  tabela: Record<string, Preco> = PRECOS
): Escolha {
  const padrao = config.provider === "anthropic" ? MODELO_HAIKU : MODELO_GPT_MINI;
  const dificilPadrao = config.provider === "anthropic" ? MODELO_SONNET : MODELO_GPT_MINI;
  const valido = (m: string | null | undefined) =>
    m && modeloConhecido(m, tabela) && tabela[m].provider === config.provider ? m : null;
  const base = valido(config.modelo) ?? padrao;
  if (sinais.dificil || sinais.incerto) {
    return { provider: config.provider, modelo: valido(config.modeloDificil) ?? dificilPadrao, motivo: "dificil" };
  }
  return { provider: config.provider, modelo: base, motivo: "padrao" };
}

/** Custo em micro-dólar (1 dólar = 1.000.000), inteiro pra somar no banco sem erro de ponto flutuante. */
export function custoUsdMicro(modelo: string, uso: Uso, tabela: Record<string, Preco> = PRECOS): number {
  const p = tabela[modelo] ?? PRECOS[modelo];
  if (!p) return 0;
  // $/1M tokens * tokens = micro-dólar direto.
  const total = p.entrada * uso.tokensIn + p.saida * uso.tokensOut + p.cacheLeitura * uso.cacheRead + p.cacheEscrita * uso.cacheWrite;
  return Math.ceil(total);
}

/** Estimativa grosseira de tokens: ~3,5 caracteres por token em português. */
export function estimarTokens(texto: string): number {
  return Math.ceil(texto.length / 3.5);
}

/** Pior caso de uma chamada (sem cache, saída cheia), usado antes de chamar. */
export function custoMaximoUsdMicro(
  modelo: string,
  caracteresEntrada: number,
  maxTokensSaida: number,
  tabela: Record<string, Preco> = PRECOS
): number {
  return custoUsdMicro(modelo, { tokensIn: Math.ceil(caracteresEntrada / 3.5), tokensOut: maxTokensSaida, cacheRead: 0, cacheWrite: 0 }, tabela);
}
