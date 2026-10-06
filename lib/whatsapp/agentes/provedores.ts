/**
 * Chamada aos modelos pelas APIs oficiais, com fetch (sem SDK novo).
 *
 * - Anthropic: POST https://api.anthropic.com/v1/messages. A parte fixa do
 *   Comando de sistema leva cache_control (prompt caching); a parte que muda a
 *   cada mensagem (trechos do cérebro, memória) vem depois do ponto de cache.
 * - OpenAI: POST https://api.openai.com/v1/chat/completions. O cache é
 *   automático por prefixo, então a parte fixa vai primeiro, e prompt_cache_key
 *   agrupa as chamadas do mesmo número. A URL é fixa: o OPENAI_BASE_URL do
 *   ambiente (que pode apontar pra um Ollama local) não é lido aqui.
 *
 * A chave do dono entra só no cabeçalho. Nenhum erro carrega a chave nem o
 * corpo da resposta do provedor (que às vezes ecoa parte dela).
 */
import type { IaProvider, Uso } from "./types";

export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
export const ANTHROPIC_VERSION = "2023-06-01";

export interface MensagemChat {
  role: "user" | "assistant";
  content: string;
}

export interface PedidoModelo {
  provider: IaProvider;
  modelo: string;
  apiKey: string;
  /** Parte estável do Comando de sistema (vai pro cache). */
  sistemaFixo: string;
  /** Parte que muda a cada chamada. */
  sistemaVariavel: string;
  mensagens: MensagemChat[];
  maxTokens: number;
  /** Agrupa o cache da OpenAI (ex.: id do número). Não é segredo. */
  chaveCache?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface RespostaModelo {
  texto: string;
  uso: Uso;
}

export type CodigoErroModelo = "chave_invalida" | "sem_saldo" | "limite" | "fora_do_ar" | "pedido_invalido" | "timeout" | "rede" | "recusa";

export class ErroModelo extends Error {
  constructor(
    public codigo: CodigoErroModelo,
    public status: number | null
  ) {
    super(mensagemErro(codigo));
    this.name = "ErroModelo";
  }
}

/** Texto pra tela, em PT-BR. */
export function mensagemErro(codigo: CodigoErroModelo): string {
  switch (codigo) {
    case "chave_invalida":
      return "A chave de API da IA foi recusada. Confira ou troque a chave nas configurações do agente.";
    case "sem_saldo":
      return "A conta da IA está sem saldo ou atingiu o limite de gasto. Coloque crédito no painel do provedor.";
    case "limite":
      return "O provedor da IA pediu pra esperar um pouco (limite de pedidos). O agente tenta de novo na próxima mensagem.";
    case "fora_do_ar":
      return "O provedor da IA está fora do ar agora. O agente tenta de novo na próxima mensagem.";
    case "timeout":
      return "A IA demorou demais pra responder.";
    case "rede":
      return "Não deu pra falar com o provedor da IA (erro de rede).";
    case "recusa":
      return "A IA se recusou a responder essa mensagem. Responda você mesmo.";
    default:
      return "O pedido pra IA foi recusado. Confira o modelo escolhido nas configurações do agente.";
  }
}

async function codigoDoStatus(res: Response): Promise<CodigoErroModelo> {
  if (res.status === 401 || res.status === 403) return "chave_invalida";
  if (res.status === 402) return "sem_saldo";
  if (res.status === 429) {
    // OpenAI usa 429 + insufficient_quota pra falta de saldo.
    const corpo = await res.text().catch(() => "");
    return /insufficient_quota|billing/i.test(corpo) ? "sem_saldo" : "limite";
  }
  if (res.status >= 500) return "fora_do_ar";
  const corpo = await res.text().catch(() => "");
  if (/credit balance|billing|quota/i.test(corpo)) return "sem_saldo";
  return "pedido_invalido";
}

async function postar(url: string, headers: Record<string, string>, body: unknown, p: PedidoModelo): Promise<Record<string, unknown>> {
  const fetchImpl = p.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), p.timeoutMs ?? 45000);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    throw new ErroModelo((e as Error)?.name === "AbortError" ? "timeout" : "rede", null);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new ErroModelo(await codigoDoStatus(res), res.status);
  return (await res.json()) as Record<string, unknown>;
}

async function chamarAnthropic(p: PedidoModelo): Promise<RespostaModelo> {
  const body: Record<string, unknown> = {
    model: p.modelo,
    max_tokens: p.maxTokens,
    system: [
      { type: "text", text: p.sistemaFixo, cache_control: { type: "ephemeral" } },
      ...(p.sistemaVariavel ? [{ type: "text", text: p.sistemaVariavel }] : []),
    ],
    messages: p.mensagens,
  };
  // Sonnet 5 pensa por padrão (adaptativo); esforço baixo segura o custo numa resposta curta.
  if (p.modelo.startsWith("claude-sonnet-5")) body.output_config = { effort: "low" };

  const d = await postar(ANTHROPIC_URL, { "x-api-key": p.apiKey, "anthropic-version": ANTHROPIC_VERSION }, body, p);
  if (d.stop_reason === "refusal") throw new ErroModelo("recusa", 200);
  const blocos = (d.content as Array<{ type: string; text?: string }>) ?? [];
  const texto = blocos
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  const u = (d.usage as Record<string, number>) ?? {};
  return {
    texto,
    uso: {
      tokensIn: u.input_tokens ?? 0,
      tokensOut: u.output_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
    },
  };
}

async function chamarOpenAI(p: PedidoModelo): Promise<RespostaModelo> {
  const body: Record<string, unknown> = {
    model: p.modelo,
    max_completion_tokens: p.maxTokens,
    reasoning_effort: "minimal",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: p.sistemaFixo },
      ...(p.sistemaVariavel ? [{ role: "system", content: p.sistemaVariavel }] : []),
      ...p.mensagens,
    ],
  };
  if (p.chaveCache) body.prompt_cache_key = p.chaveCache;

  const d = await postar(OPENAI_URL, { Authorization: `Bearer ${p.apiKey}` }, body, p);
  const escolha = ((d.choices as Array<{ message?: { content?: string | null; refusal?: string | null } }>) ?? [])[0];
  if (escolha?.message?.refusal) throw new ErroModelo("recusa", 200);
  const u = (d.usage as { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }) ?? {};
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    texto: escolha?.message?.content ?? "",
    uso: {
      tokensIn: Math.max(0, (u.prompt_tokens ?? 0) - cached),
      tokensOut: u.completion_tokens ?? 0,
      cacheRead: cached,
      cacheWrite: 0,
    },
  };
}

export function chamarModelo(p: PedidoModelo): Promise<RespostaModelo> {
  return p.provider === "anthropic" ? chamarAnthropic(p) : chamarOpenAI(p);
}

export type ChamarModelo = typeof chamarModelo;
