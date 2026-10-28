/**
 * Regras de conversa do vendedor (puras): pergunta final obrigatória, anti-repetição de abertura,
 * Lições do dono e exemplos aprendidos (rascunho vs versão do dono). Nada de banco ou rede.
 */
import { exemplosParecidos, limparExemplo, MAX_PERGUNTA, MAX_RESPOSTA, type ExemploAprendido } from "@/lib/whatsapp/regras/exemplos";
import { normalizarTexto } from "@/lib/whatsapp/regras/texto";

export const MAX_LICOES = 2000;
export const ABERTURAS_GUARDADAS = 12;
export const EXEMPLOS_NO_PROMPT = 3;

export const DEFAULT_LICOES = `1. Entre direto na conversa, sem se apresentar. Nunca diga que é IA por conta própria; só se a pessoa perguntar sério, e aí nunca negue.
2. Comece pelo que a pessoa acabou de dizer e varie abertura, pergunta e ritmo: nunca a mesma mensagem pra pessoas diferentes.
3. Uma pergunta só, na última parte. Até 3 partes curtas, estilo zap, "você", sem lista.
4. Entender em no máximo 2 perguntas, usando a ficha (não pergunte o que já sabe) e ligar o Chat Sem Frescura ao negócio dela.
5. Preço só no final, com a pessoa quente: primeiro 12x de R$ 10,03, depois R$ 97 à vista. Nunca despejar preço cedo.
6. Quem quer comprar vai direto pro link de compra ou pra página. Nunca chame o Matheus pra ligar.
7. Só afirme sobre ferramenta o que está na base. Sem chute técnico. Vídeo no Gemini costuma exigir plano pago do Google: não prometa grátis.
8. Não prometa resultado, ganho nem prazo. A IA é apoio, a pessoa aplica.
9. Objeção de preço: mostre o que ela faz com o que aprende, sem inventar desconto.
10. Depois de uma resposta curta da pessoa ("sim", "ok"), ofereça duas opções concretas em vez de pergunta aberta.`;

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

const STOP = new Set(["de", "a", "o", "e", "que", "do", "da", "em", "um", "uma", "pra", "pro", "com", "no", "na"]);

function palavras(s: string): string[] {
  return chave(s).replace(/[^\p{L}\p{N}\s$,]/gu, " ").split(/\s+/).filter((w) => w && !STOP.has(w));
}

/** Similaridade 0..1 entre dois textos (Jaccard de pares de palavras). Curtinhos demais devolvem 0. */
export function similaridade(a: string, b: string): number {
  const pa = palavras(a);
  const pb = palavras(b);
  if (pa.length < 6 || pb.length < 6) return 0;
  const bi = (w: string[]) => new Set(w.slice(1).map((x, i) => `${w[i]} ${x}`));
  const A = bi(pa);
  const B = bi(pb);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const uni = A.size + B.size - inter;
  return uni ? inter / uni : 0;
}

export const LIMITE_SIMILARIDADE = 0.5;

/** A resposta (inteira ou uma parte) é quase igual a algo que já mandamos a outra pessoa. */
export function repetiuTexto(partes: string[], recentes: string[]): boolean {
  const todo = partes.join(" ");
  return recentes.some((r) => similaridade(todo, r) >= LIMITE_SIMILARIDADE || r.split(/\n{2,}/).some((rp) => partes.some((p) => similaridade(p, rp) >= 0.7)));
}

const SE_APRESENTOU_NOME = /\b(?:[Aa]qui [eé] (?:o|a) [A-ZÀ-Ú]|[Ee]u sou (?:o|a) [A-ZÀ-Ú]|[Ss]ou (?:o|a) [A-ZÀ-Ú])/;
const SE_APRESENTOU_FRASE = /\b(meu nome [eé]|me chamo|prazer,? (em|eu)|aqui [eé] (o|a) gil|sou (o|a) gil)/i;
const CHAMOU_LIGACAO = /\b(te ligo|te ligar|me liga|ligar pra (voc[eê]|mim)|uma (call|liga[cç][aã]o|chamada)|marcar (uma )?(call|liga[cç][aã]o|chamada)|falar (com o matheus )?por (telefone|voz|[aá]udio))/i;
const SE_DISSE_IA = /\bsou (uma |um )?(ia|intelig[eê]ncia artificial|rob[oô]|bot|assistente virtual)\b/i;
const CITOU_PRECO = /R\$\s?\d|\b\d+\s?x\s+de\b|\b(12|doze)x\b/i;
const PEDIU_PRECO = /pre[cç]o|valor|quanto|custa|parcel|pagar|pagamento|comprar|compra|link|checkout|investimento|cart[aã]o|pix|boleto|\bvista\b|garantir|quero entrar|quero comprar/i;

/** Estágios em que a pessoa já está quente o bastante pra ouvir o preço. */
const ESTAGIOS_QUENTES = new Set(["viu_valor", "recebeu_link"]);

export type ContextoDaResposta = { textosRecentes?: string[]; ultimaDaPessoa?: string; estagio?: string; permiteIdentidade?: boolean };

/** Regras de venda e de identidade em código (o Comando já pede; aqui é a segunda trava). */
export function problemasDeConteudo(partes: string[], ctx: ContextoDaResposta = {}): string[] {
  const t = partes.join("\n");
  const p: string[] = [];
  if (SE_APRESENTOU_NOME.test(t) || SE_APRESENTOU_FRASE.test(t)) p.push("se apresentou (entre direto na conversa, sem 'aqui é o...')");
  if (SE_DISSE_IA.test(t) && !ctx.permiteIdentidade) p.push("disse sozinho que é IA/robô (só se a pessoa perguntar)");
  if (CHAMOU_LIGACAO.test(t)) p.push("chamou pra ligação/call (quem quer comprar vai pro link de compra ou pra página)");
  if (CITOU_PRECO.test(t.replace(/https?:\/\/\S+/g, ""))) {
    const quente = ESTAGIOS_QUENTES.has(ctx.estagio ?? "") || PEDIU_PRECO.test(ctx.ultimaDaPessoa ?? "");
    if (!quente) p.push("citou preço cedo demais (a pessoa ainda não está quente nem perguntou)");
    else if (/\b97\b/.test(t) && !/10,03/.test(t) && !/vista|pix/i.test(ctx.ultimaDaPessoa ?? "")) p.push("falou o à vista antes do parcelado (primeiro 12x de R$ 10,03)");
  }
  return p;
}

/** Problemas da resposta que justificam UMA reescrita. Vazio = ok. */
export function problemasDaResposta(partes: string[], recentes: string[], ctx: ContextoDaResposta = {}): string[] {
  const p: string[] = [];
  if (!terminaComPergunta(partes)) p.push("a última parte não termina com uma pergunta");
  else if (contarPerguntas(partes) > 1) p.push("tem mais de uma pergunta (só pode ser UMA, na última parte)");
  if (repetiuAbertura(partes, recentes)) p.push("a abertura repete uma que já usamos em outra conversa");
  else if (repetiuTexto(partes, ctx.textosRecentes ?? [])) p.push("o texto é quase igual a uma mensagem que já mandamos a outra pessoa (mude abertura, pergunta e ritmo)");
  for (const x of problemasDeConteudo(partes, ctx)) p.push(x);
  if (partes.length > 3) p.push("tem mais de 3 partes (no máximo 3)");
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
