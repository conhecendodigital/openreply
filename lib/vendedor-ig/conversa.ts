/**
 * Regras de conversa do vendedor (puras): pergunta final obrigatória, anti-repetição de abertura,
 * Lições do dono e exemplos aprendidos (rascunho vs versão do dono). Nada de banco ou rede.
 */
import { exemplosParecidos, limparExemplo, MAX_PERGUNTA, MAX_RESPOSTA, type ExemploAprendido } from "@/lib/whatsapp/regras/exemplos";
import { normalizarTexto } from "@/lib/whatsapp/regras/texto";

export const MAX_LICOES = 2000;
export const ABERTURAS_GUARDADAS = 12;
export const EXEMPLOS_NO_PROMPT = 3;

export const DEFAULT_LICOES = `1. Não repetir a mesma abertura de outras conversas: comece pelo que a pessoa acabou de dizer.
2. Nunca fazer duas ou mais perguntas na mesma resposta. Uma pergunta só, na última mensagem.
3. Não prometer resultado, ganho nem prazo. A IA é apoio, a pessoa aplica.
4. Entender em no máximo 2 perguntas e já ligar o Chat Sem Frescura ao negócio dela.
5. Não empurrar o link antes de a pessoa mostrar interesse. Quando mostrar, mandar o link e perguntar se ficou alguma dúvida.
6. Objeção de preço: mostrar o que ela faz com o que aprende, sem inventar desconto.`;

export function licoesQueValem(licoes: string): string {
  return licoes.trim() ? licoes.trim() : DEFAULT_LICOES;
}

/** A última parte termina em "?" (aceita aspas, parêntese e emoji depois). */
export function terminaComPergunta(partes: string[]): boolean {
  const ultima = partes[partes.length - 1]?.trim() ?? "";
  return /\?[\s"')\]\u{1F300}-\u{1FAFF}☀-➿️]*$/u.test(ultima);
}

/** Quantos "?" a resposta toda tem (links ficam de fora: têm "?" na query). */
export function contarPerguntas(partes: string[]): number {
  return (partes.join(" ").replace(/https?:\/\/\S+/g, "").match(/\?/g) ?? []).length;
}

function chave(s: string): string {
  return normalizarTexto(s).replace(/\s+/g, " ").trim();
}

/** Primeira parte (a abertura) de um texto salvo, partes separadas por linha em branco. */
export function aberturaDe(texto: string): string {
  return (texto.split(/\n{2,}/)[0] ?? "").trim();
}

export function repetiuAbertura(partes: string[], recentes: string[]): boolean {
  const k = chave(partes[0] ?? "");
  return k.length >= 8 && recentes.some((r) => chave(r) === k);
}

/** Problemas da resposta que justificam UMA reescrita. Vazio = ok. */
export function problemasDaResposta(partes: string[], recentes: string[]): string[] {
  const p: string[] = [];
  if (!terminaComPergunta(partes)) p.push("a última parte não termina com uma pergunta");
  else if (contarPerguntas(partes) > 1) p.push("tem mais de uma pergunta (só pode ser UMA, na última parte)");
  if (repetiuAbertura(partes, recentes)) p.push("a abertura repete uma que já usamos em outra conversa");
  return p;
}

export function pedidoDeReescrita(problemas: string[]): string {
  return `Reescreva a resposta corrigindo: ${problemas.join("; ")}. Mantenha as regras de voz, os fatos e o JSON no mesmo formato. A última parte termina com UMA pergunta curta e específica.`;
}

/** Bloco "não repita estas" do prompt. */
export function blocoAberturas(recentes: string[]): string {
  const l = recentes.slice(0, ABERTURAS_GUARDADAS).map((a) => `- ${a.replace(/\s+/g, " ").slice(0, 120)}`);
  return l.length ? `ABERTURAS QUE JÁ USAMOS EM OUTRAS CONVERSAS (não repita estas nem copie o jeito; abra com algo ligado ao que a pessoa disse):\n${l.join("\n")}` : "";
}

export type ExemploVendedor = { pergunta: string; rascunho: string | null; resposta: string; createdAt?: Date };

/** Par rascunho x versão do dono, anonimizado. null se nada mudou ou faltou a pergunta. */
export function montarExemplo(input: { pergunta: string; rascunho: string; resposta: string; nomes: string[] }): ExemploVendedor | null {
  const pergunta = limparExemplo(input.pergunta, input.nomes, MAX_PERGUNTA);
  const resposta = limparExemplo(input.resposta, input.nomes, MAX_RESPOSTA);
  const rascunho = limparExemplo(input.rascunho, input.nomes, MAX_RESPOSTA);
  if (pergunta.length < 3 || resposta.length < 2) return null;
  if (chave(rascunho) === chave(resposta)) return null;
  return { pergunta, rascunho: rascunho || null, resposta };
}

/** Até 3 exemplos parecidos com a conversa atual. */
export function exemplosDoPrompt(todos: ExemploVendedor[], consulta: string): ExemploVendedor[] {
  const base: ExemploAprendido[] = todos.map((e, i) => ({ id: String(i), sessionId: "", agente: null, origem: "edicao", origemId: String(i), pergunta: e.pergunta, resposta: e.resposta, rascunho: e.rascunho, createdAt: e.createdAt }));
  return exemplosParecidos(base, consulta, "atendimento", EXEMPLOS_NO_PROMPT).map((e) => todos[Number(e.id)]);
}

export function blocoExemplos(lista: ExemploVendedor[]): string {
  if (!lista.length) return "";
  const t = lista.map((e) => `Pessoa: ${e.pergunta}${e.rascunho ? `\nRascunho nosso (o dono mudou): ${e.rascunho}` : ""}\nVersão do dono: ${e.resposta}`).join("\n\n");
  return `COMO O DONO JÁ CORRIGIU RESPOSTAS PARECIDAS (referência de jeito, nunca regra; não copie fatos, preço ou link daqui):\n${t}`;
}
