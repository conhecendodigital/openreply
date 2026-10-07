/**
 * Travas de conteúdo: o agente nunca cita preço, prazo, porcentagem, link ou endereço que
 * não esteja nos trechos do cérebro (PDFs), no Comando base ou nos fatos que o
 * usuário cadastrou. Se citar, a resposta não sai sozinha: vira rascunho com o
 * aviso do que foi inventado.
 */

export interface Afirmacao {
  tipo: "preco" | "prazo" | "porcentagem" | "link" | "endereco";
  texto: string;
  chave: string;
}

const RE_PRECO = /R\$\s?\d[\d.]*(?:,\d{1,2})?|\b\d[\d.]*(?:,\d{1,2})?\s?(?:reais|real)\b/gi;
const RE_PRAZO = /\b\d+\s?(?:dias?(?:\s[uú]teis)?|horas?|h\b|semanas?|meses|m[eê]s|minutos?|min\b|anos?)/gi;
const RE_PORCENTAGEM = /\b\d+(?:[.,]\d+)?\s?%/g;
const RE_LINK = /\b(?:https?:\/\/\S+|www\.\S+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|br|net|org|io|app|me|ly|link|site|store|shop|online)(?:\/\S*)?)/gi;

// "Av. Presidente Costa e Silva, 186", "Rua Bom Jesus nº 212". O nome começa com
// maiúscula ou número pra não pegar "na rua tem 2 vagas".
const RE_ENDERECO =
  /(?<![\p{L}\d])(?:[Rr]ua|R\.|[Aa]venida|[Aa]v\.?|AV\.?|[Aa]lameda|[Tt]ravessa|[Ee]strada|[Rr]odovia|[Pp]ra[çc]a)\s+((?:d[aeo]s? )?[A-ZÀ-Ý0-9][\p{L}\d.' ]{1,60}?)[,\s]+(?:n[º°o.]?\s*)?(\d{1,5})(?!\d)/gu;
const RE_CEP = /\b\d{5}-\d{3}\b/g;

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Última palavra do nome da rua + número: "Pres. Costa e Silva, 186" e "Presidente Costa e Silva 186" batem. */
function chaveEndereco(nome: string, numero: string): string {
  const palavras = semAcento(nome).replace(/[.']/g, " ").split(/\s+/).filter(Boolean);
  return `${palavras[palavras.length - 1] ?? ""}:${Number(numero)}`;
}

function valorDinheiro(s: string): string {
  const num = s.replace(/[^\d,.]/g, "");
  // 1.997,00 -> 1997.00 ; 97 -> 97
  const normal = num.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const v = Number.parseFloat(normal);
  return Number.isFinite(v) ? v.toFixed(2) : num;
}

function normalLink(s: string): string {
  return s
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[)\].,!?;:'"]+$/, "")
    .replace(/\/+$/, "");
}

function normalPrazo(s: string): string {
  const n = s.match(/\d+/)?.[0] ?? "";
  const u = s.toLowerCase().replace(/[\d\s]/g, "");
  const unidade = u.startsWith("dia")
    ? u.includes("t") ? "diautil" : "dia"
    : u.startsWith("h")
      ? "hora"
      : u.startsWith("semana")
        ? "semana"
        : u.startsWith("mes") || u.startsWith("mês")
          ? "mes"
          : u.startsWith("min")
            ? "min"
            : "ano";
  return `${n}${unidade}`;
}

export function extrairAfirmacoes(texto: string): Afirmacao[] {
  const out: Afirmacao[] = [];
  for (const m of texto.match(RE_PRECO) ?? []) out.push({ tipo: "preco", texto: m.trim(), chave: valorDinheiro(m) });
  for (const m of texto.match(RE_PRAZO) ?? []) out.push({ tipo: "prazo", texto: m.trim(), chave: normalPrazo(m) });
  for (const m of texto.match(RE_PORCENTAGEM) ?? []) out.push({ tipo: "porcentagem", texto: m.trim(), chave: m.replace(/\s/g, "").replace(",", ".") });
  for (const m of texto.matchAll(RE_ENDERECO)) out.push({ tipo: "endereco", texto: m[0].trim(), chave: chaveEndereco(m[1], m[2]) });
  for (const m of texto.match(RE_CEP) ?? []) out.push({ tipo: "endereco", texto: m, chave: `cep:${m.replace(/\D/g, "")}` });
  for (const m of texto.match(RE_LINK) ?? []) {
    // "R$ 1.997" não é link; números com ponto também não.
    if (/^\d[\d.]*$/.test(m)) continue;
    out.push({ tipo: "link", texto: m.replace(/[)\].,!?;:'"]+$/, ""), chave: normalLink(m) });
  }
  return out;
}

/** O que a resposta cita e que não aparece em nenhuma fonte permitida. */
export function afirmacoesInventadas(resposta: string, fontes: string): Afirmacao[] {
  const permitidas = extrairAfirmacoes(fontes);
  const chaves = new Set(permitidas.map((a) => `${a.tipo}:${a.chave}`));
  const linksPermitidos = permitidas.filter((a) => a.tipo === "link").map((a) => a.chave);
  return extrairAfirmacoes(resposta).filter((a) => {
    if (chaves.has(`${a.tipo}:${a.chave}`)) return false;
    // Link mais curto que um permitido (ex.: só o domínio) também vale.
    if (a.tipo === "link" && linksPermitidos.some((l) => l === a.chave || l.startsWith(`${a.chave}/`))) return false;
    return true;
  });
}

export function descreverInventadas(lista: Afirmacao[]): string {
  const nomes = { preco: "preço", prazo: "prazo", porcentagem: "porcentagem", link: "link", endereco: "endereço" } as const;
  return `A resposta cita ${lista.map((a) => `${nomes[a.tipo]} "${a.texto}"`).join(", ")}, que não está nos seus PDFs nem nas configurações. Confira antes de enviar.`;
}
