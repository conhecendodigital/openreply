/**
 * Cliente do Jev (TypeSafe, "System One"), só no servidor.
 *
 * O Jev não escreve texto: escolhe (choice), diz sim ou não (noul) e dá nota
 * (score) em ~0,3 s, por uma fração do preço de um modelo de conversa. Aqui ele
 * faz a triagem antes do modelo caro e confere a resposta antes de enviar.
 *
 * Mesmo contrato do scripts/jev.py do Matheus: POST /v1/systemone com
 * {state, model: "jev-latest", questions}. Chave em TYPESAFE_API_KEY, nunca em
 * log nem em mensagem de erro.
 */

export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_MODELO = "jev-latest";
/** Abaixo disso a resposta vem marcada "incerto". */
export const JEV_CONF_MIN = 0.6;

export type JevPergunta =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevResposta =
  | { tipo: "choice"; escolha: string; confianca: number; probabilidades?: Record<string, number> }
  | { tipo: "noul"; sim: number }
  | { tipo: "score"; nota: number; confianca: number };

export type JevResultado =
  | { ok: true; respostas: Record<string, JevResposta>; incerto: boolean; tokens: number; ms: number }
  | { ok: false; erro: string };

export interface JevOpcoes {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  timeoutMs?: number;
  tentativas?: number;
  esperar?: (ms: number) => Promise<void>;
  /** Cada chamada que deu certo (tokens de entrada), pro relatório de gastos de IA. */
  aoUsar?: (tokens: number) => Promise<void> | void;
}

const esperaPadrao = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function jevConfigurado(apiKey = process.env.TYPESAFE_API_KEY): boolean {
  return Boolean(apiKey && apiKey.trim());
}

function interpretar(answers: Record<string, unknown>): { respostas: Record<string, JevResposta>; incerto: boolean } {
  const respostas: Record<string, JevResposta> = {};
  let incerto = false;
  for (const [nome, bruto] of Object.entries(answers)) {
    const a = bruto as Record<string, unknown>;
    if (a.type === "choice" && typeof a.choice === "string") {
      const confianca = Number(a.confidence ?? 0);
      respostas[nome] = {
        tipo: "choice",
        escolha: a.choice,
        confianca,
        probabilidades: (a.probabilities as Record<string, number>) ?? undefined,
      };
      if (confianca < JEV_CONF_MIN) incerto = true;
    } else if (a.type === "noul") {
      const sim = Number(a.noul ?? 0.5);
      respostas[nome] = { tipo: "noul", sim };
      if (sim > 0.35 && sim < 0.65) incerto = true;
    } else if (a.type === "score") {
      const confianca = Number(a.confidence ?? 0);
      respostas[nome] = { tipo: "score", nota: Number(a.score ?? 0), confianca };
      if (confianca < JEV_CONF_MIN) incerto = true;
    }
  }
  return { respostas, incerto };
}

export async function perguntarJev(
  estado: Record<string, unknown>,
  perguntas: Record<string, JevPergunta>,
  opcoes: JevOpcoes = {}
): Promise<JevResultado> {
  const apiKey = (opcoes.apiKey ?? process.env.TYPESAFE_API_KEY ?? "").trim();
  if (!apiKey) return { ok: false, erro: "sem_chave" };
  const fetchImpl = opcoes.fetchImpl ?? fetch;
  const tentativas = Math.max(1, opcoes.tentativas ?? 2);
  const esperar = opcoes.esperar ?? esperaPadrao;
  const body = JSON.stringify({ state: estado, model: JEV_MODELO, questions: perguntas });
  let erro = "desconhecido";

  for (let t = 0; t < tentativas; t++) {
    const inicio = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opcoes.timeoutMs ?? 8000);
    try {
      const res = await fetchImpl(JEV_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        // Só o código: o corpo pode ecoar cabeçalhos e a chave não pode vazar.
        erro = `http_${res.status}`;
        if (res.status < 500 && res.status !== 429) break;
      } else {
        const dados = (await res.json()) as { answers?: Record<string, unknown>; usage?: { input_tokens?: number } };
        const { respostas, incerto } = interpretar(dados.answers ?? {});
        await Promise.resolve(opcoes.aoUsar?.(dados.usage?.input_tokens ?? 0)).catch(() => {});
        return { ok: true, respostas, incerto, tokens: dados.usage?.input_tokens ?? 0, ms: Date.now() - inicio };
      }
    } catch (e) {
      erro = (e as Error)?.name === "AbortError" ? "timeout" : "rede";
    } finally {
      clearTimeout(timer);
    }
    if (t < tentativas - 1) await esperar(1500 * (t + 1));
  }
  return { ok: false, erro };
}

/* ---------- Perguntas prontas do WhatsApp ---------- */

export const PERGUNTAS_TRIAGEM: Record<string, JevPergunta> = {
  acao: {
    type: "choice",
    instructions:
      "Mensagem que um cliente mandou no WhatsApp de um pequeno negócio. Use o contexto (últimas mensagens). O que o negócio deve fazer?",
    criteria: {
      responder: "Pergunta, pedido, dúvida ou conversa que pede uma resposta",
      nao_precisa: "Só confirma ou encerra: ok, obrigado, beleza, joinha, emoji, áudio de agradecimento",
      humano:
        "Reclamação, cobrança, reembolso, cancelamento, ameaça, Procon, advogado, saúde, assunto delicado ou pede pra falar com uma pessoa",
      spam: "Golpe, propaganda, corrente, link estranho, mensagem automática de outro robô",
    },
  },
  agente: {
    type: "choice",
    instructions: "Quem do time responde melhor essa mensagem?",
    criteria: {
      qualificacao: "Pessoa nova ou interessada: quer saber o que é, preço, como funciona, se serve pra ela",
      atendimento: "Já está conversando sobre um pedido, agendamento, orçamento, entrega ou compra em andamento",
      suporte: "Já é cliente e tem problema: acesso, defeito, erro, troca, não recebeu",
    },
  },
  dificil: {
    type: "noul",
    instructions:
      "A mensagem é difícil de responder bem (várias perguntas juntas, negociação, cliente irritado, assunto técnico ou ambíguo)?",
  },
};

export const PERGUNTAS_CHECAR: Record<string, JevPergunta> = {
  cara_ia: {
    type: "noul",
    instructions:
      "Essa resposta de WhatsApp soa escrita por robô ou IA (formal demais, frases de efeito, 'não é X, é Y', listas, travessão, muito longa)?",
  },
  guru: {
    type: "noul",
    instructions: "A resposta promete resultado exagerado, garante ganho ou tem tom de guru de internet?",
  },
  responde: {
    type: "noul",
    instructions: "A resposta responde de verdade o que o cliente perguntou na última mensagem?",
  },
};
