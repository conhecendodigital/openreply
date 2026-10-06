/**
 * Aprender o tom do usuário pelas mensagens que ELE mesmo mandou
 * (fromMe, sentBy USER_PHONE ou USER_APP; as do agente ficam de fora pra o
 * agente não aprender com ele mesmo).
 *
 * Sem IA: só contagem (tamanho médio, emoji, "vc"/"você"/"tu", saudações,
 * despedidas, pontuação). Os exemplos pergunta/resposta passam por
 * limparDadosPessoais antes de entrar no Comando de sistema: telefone, e-mail,
 * CPF/CNPJ, link, valores de pix e o nome do contato viram marcadores. O
 * usuário revisa e edita o resultado antes de usar.
 */
import type { ExemploTom, WaMessageLite } from "./types";

export const AMOSTRA_MAX = 400;
export const EXEMPLOS_MIN = 10;
export const EXEMPLOS_MAX = 20;

const EMOJI = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;

export function limparDadosPessoais(texto: string, nomes: string[] = []): string {
  let t = texto;
  t = t.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]");
  t = t.replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[link]");
  t = t.replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[documento]");
  t = t.replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[documento]");
  t = t.replace(/\+?\d[\d\s().-]{7,}\d/g, "[telefone]");
  t = t.replace(/\b\d{5}-?\d{3}\b/g, "[cep]");
  for (const nome of nomes) {
    for (const parte of nome.split(/\s+/)) {
      if (parte.length < 3) continue;
      const seguro = parte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      t = t.replace(new RegExp(`(^|[^\\wÀ-ÿ])${seguro}(?=$|[^\\wÀ-ÿ])`, "gi"), "$1[nome]");
    }
  }
  return t;
}

export function mensagensDoUsuario(historico: WaMessageLite[]): WaMessageLite[] {
  return historico.filter(
    (m) => m.fromMe && (m.sentBy === "USER_PHONE" || m.sentBy === "USER_APP") && m.type === "text" && (m.body ?? "").trim()
  );
}

function contar(textos: string[], re: RegExp): number {
  return textos.filter((t) => re.test(t)).length;
}

function frac(n: number, total: number): number {
  return total ? n / total : 0;
}

export interface PerfilTom {
  styleSummary: string;
  styleExamples: ExemploTom[];
  amostra: number;
}

export function aprenderTom(historico: WaMessageLite[], nomesDeTerceiros: string[] = []): PerfilTom | null {
  const minhas = mensagensDoUsuario(historico).slice(-AMOSTRA_MAX);
  if (minhas.length < 5) return null;
  const textos = minhas.map((m) => (m.body ?? "").trim());
  const total = textos.length;

  const media = Math.round(textos.reduce((s, t) => s + t.length, 0) / total);
  const comEmoji = frac(textos.filter((t) => (t.match(EMOJI) ?? []).length > 0).length, total);
  const vc = contar(textos, /\b(vc|vcs)\b/i);
  const voce = contar(textos, /\bvoc[eê]s?\b/i);
  const tu = contar(textos, /\btu\b/i);
  const ce = contar(textos, /\bc[eê]\b/i);
  const minusculas = frac(textos.filter((t) => /^[a-zà-ÿ]/.test(t)).length, total);
  const pontoFinal = frac(textos.filter((t) => /\.$/.test(t)).length, total);
  const exclamacao = frac(textos.filter((t) => /!/.test(t)).length, total);
  const risada = contar(textos, /\b(k{3,}|haha+|rs+)\b/i);

  const inicio = new Map<string, number>();
  const fim = new Map<string, number>();
  for (const t of textos) {
    const s = t.match(/^(oi+|ol[aá]|opa|e a[ií]|bom dia|boa tarde|boa noite|fala|salve)\b/i);
    if (s) inicio.set(s[1].toLowerCase(), (inicio.get(s[1].toLowerCase()) ?? 0) + 1);
    const f = t.match(/(abra[cç]o|abs|tmj|valeu|qualquer coisa me chama|fico [àa] disposi[cç][aã]o|beijos?|bjs)[\s!.]*$/i);
    if (f) fim.set(f[1].toLowerCase(), (fim.get(f[1].toLowerCase()) ?? 0) + 1);
  }
  const top = (m: Map<string, number>) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k]) => `"${k}"`);

  const tratamento =
    vc >= voce && vc >= tu && vc > 0
      ? 'escreve "vc"'
      : tu > voce
        ? 'usa "tu" às vezes'
        : ce > voce
          ? 'usa "cê"'
          : 'escreve "você"';

  const linhas = [
    `Mensagens curtas: em média ${media} caracteres.`,
    `${tratamento}.`,
    comEmoji >= 0.3 ? "Usa emoji com frequência." : comEmoji >= 0.08 ? "Usa emoji de vez em quando." : "Quase não usa emoji.",
    minusculas >= 0.5 ? "Costuma começar em minúscula." : "Começa as frases com maiúscula.",
    pontoFinal < 0.3 ? "Quase nunca põe ponto final." : "Põe ponto final.",
    exclamacao >= 0.3 ? "Usa bastante exclamação." : "Usa pouca exclamação.",
    risada >= 3 ? 'Ri escrevendo "kkk" ou "haha".' : "",
    inicio.size ? `Cumprimenta com ${top(inicio).join(", ")}.` : "",
    fim.size ? `Fecha com ${top(fim).join(", ")}.` : "",
  ].filter(Boolean);

  return { styleSummary: linhas.join(" "), styleExamples: escolherExemplos(historico, nomesDeTerceiros), amostra: total };
}

/** Pares reais: mensagem do contato seguida da resposta do usuário. */
export function escolherExemplos(historico: WaMessageLite[], nomesDeTerceiros: string[] = []): ExemploTom[] {
  const pares: ExemploTom[] = [];
  for (let i = 1; i < historico.length; i++) {
    const r = historico[i];
    const p = historico[i - 1];
    if (!r.fromMe || (r.sentBy !== "USER_PHONE" && r.sentBy !== "USER_APP") || p.fromMe) continue;
    if (r.type !== "text" || p.type !== "text") continue;
    const pergunta = limparDadosPessoais((p.body ?? "").trim(), nomesDeTerceiros).slice(0, 200);
    const resposta = limparDadosPessoais((r.body ?? "").trim(), nomesDeTerceiros).slice(0, 300);
    if (pergunta.length < 8 || resposta.length < 4) continue;
    pares.push({ pergunta, resposta });
  }
  // Os mais recentes primeiro, sem repetir resposta.
  const vistos = new Set<string>();
  const out: ExemploTom[] = [];
  for (const par of pares.reverse()) {
    const k = par.resposta.toLowerCase();
    if (vistos.has(k)) continue;
    vistos.add(k);
    out.push(par);
    if (out.length >= EXEMPLOS_MAX) break;
  }
  return out;
}
