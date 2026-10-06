/**
 * Texto das regras: comparar sem acento nem maiúscula, e o formato de "uma
 * por linha" da tela Agentes (ida e volta, sem perder nada).
 */
import {
  CidadeSchema,
  InfoMinimaSchema,
  ItemSchema,
  RegiaoCuidadoSchema,
  type Cidade,
  type InfoMinima,
  type ItemRegra,
  type RegiaoCuidado,
} from "./esquema";

/** Minúsculo, sem acento, só letras, números e espaço. "Paulínia/SP" -> "paulinia sp". */
export function normalizarTexto(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Igual a normalizarTexto, mas guarda o fim de frase (. ! ? e quebra de linha) pra olhar uma frase de cada vez. */
export function normalizarFrase(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.!?\n]+/g, " ")
    .replace(/(\d)\.(\d)/g, "$1$2")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Regex de uma expressão inteira (palavra a palavra), no texto já normalizado. */
export function regexTermo(termoNormalizado: string): RegExp {
  const partes = termoNormalizado.split(" ").filter(Boolean).map(escaparRegex);
  return new RegExp(`(?:^|\\s)${partes.join("\\s+")}(?=\\s|$)`, "g");
}

/** Posições (no texto normalizado) onde o termo aparece inteiro. */
export function acharTermo(textoNormalizado: string, termo: string): number[] {
  const t = normalizarTexto(termo);
  if (t.length < 2) return [];
  const out: number[] = [];
  for (const m of textoNormalizado.matchAll(regexTermo(t))) out.push((m.index ?? 0) + (m[0].startsWith(" ") ? 1 : 0));
  return out;
}

export function contemTermo(textoNormalizado: string, termo: string): boolean {
  return acharTermo(textoNormalizado, termo).length > 0;
}

/* ------------------------- formato da tela (uma por linha) ------------------------- */

function linhas(texto: string): string[] {
  return texto
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export const UFS = new Set([
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
]);

/** "Paulínia/SP", "Campinas - SP", "Campinas SP" ou só "Campinas". */
export function lerCidade(linha: string): Cidade | null {
  const l = linha.trim().replace(/\s+/g, " ");
  const m = /^(.+?)\s*(?:[/,-]\s*|\s+)([A-Za-z]{2})$/.exec(l);
  const bruto = m && UFS.has(m[2].toUpperCase()) && m[1].length >= 2 ? { cidade: m[1].trim(), uf: m[2] } : { cidade: l, uf: "" };
  const r = CidadeSchema.safeParse(bruto);
  return r.success ? r.data : null;
}

export function cidadesDoTexto(texto: string): Cidade[] {
  return linhas(texto)
    .map(lerCidade)
    .filter((c): c is Cidade => Boolean(c));
}

export function cidadesParaTexto(lista: Cidade[]): string {
  return lista.map((c) => (c.uf ? `${c.cidade}/${c.uf}` : c.cidade)).join("\n");
}

/** "Campo Grande, Campinas/SP | vai pra análise sem dizer que não atende". */
export function regioesDoTexto(texto: string): RegiaoCuidado[] {
  const out: RegiaoCuidado[] = [];
  for (const l of linhas(texto)) {
    const [onde, ...resto] = l.split("|");
    const [nome, ...cidade] = onde.split(",");
    const c = cidade.length ? lerCidade(cidade.join(",")) : null;
    const r = RegiaoCuidadoSchema.safeParse({ nome: nome.trim(), cidade: c?.cidade ?? "", uf: c?.uf ?? "", regra: resto.join("|").trim() });
    if (r.success) out.push(r.data);
  }
  return out;
}

export function regioesParaTexto(lista: RegiaoCuidado[]): string {
  return lista
    .map((r) => {
      const onde = r.cidade ? `${r.nome}, ${r.uf ? `${r.cidade}/${r.uf}` : r.cidade}` : r.nome;
      return r.regra ? `${onde} | ${r.regra}` : onde;
    })
    .join("\n");
}

function palavrasDe(s: string): string[] {
  return s
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** "Pequeno reparo isolado | torneira, tomada, vazamento". */
export function itensDoTexto(texto: string): ItemRegra[] {
  const out: ItemRegra[] = [];
  for (const l of linhas(texto)) {
    const [descricao, ...resto] = l.split("|");
    const r = ItemSchema.safeParse({ descricao: descricao.trim(), palavras: palavrasDe(resto.join(",")) });
    if (r.success) out.push(r.data);
  }
  return out;
}

export function itensParaTexto(lista: ItemRegra[]): string {
  return lista.map((i) => (i.palavras.length ? `${i.descricao} | ${i.palavras.join(", ")}` : i.descricao)).join("\n");
}

/** "Situação das chaves | chave, chaves". */
export function infosDoTexto(texto: string, antes: InfoMinima[] = []): InfoMinima[] {
  const out: InfoMinima[] = [];
  for (const l of linhas(texto)) {
    const [campo, ...resto] = l.split("|");
    const anterior = antes.find((a) => normalizarTexto(a.campo) === normalizarTexto(campo));
    const r = InfoMinimaSchema.safeParse({ campo: campo.trim(), pergunta: anterior?.pergunta ?? "", palavras: palavrasDe(resto.join(",")) });
    if (r.success) out.push(r.data);
  }
  return out;
}

export function infosParaTexto(lista: InfoMinima[]): string {
  return lista.map((i) => (i.palavras.length ? `${i.campo} | ${i.palavras.join(", ")}` : i.campo)).join("\n");
}

export function textosDoTexto(texto: string): string[] {
  return linhas(texto);
}
