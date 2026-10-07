/**
 * Lugares do Brasil pra não confundir cidade, estado e bairro (07/10/2026, agente do Robério):
 * - qualquer município (IBGE) citado com "em", "de", "na"... conta, mesmo sem a UF;
 * - nome de estado ("Minas", "Paraná", "Goiás") não vira cidade;
 * - bairro e distrito de cidade atendida ("Barão Geraldo", "Cambuí") contam como a cidade,
 *   mesmo quando existe um município com o mesmo nome em outro estado (Cambuí/MG).
 */
import { BAIRROS } from "./bairros-dados";
import { MUNICIPIOS } from "./municipios-dados";
import { normalizarTexto } from "./texto";
import type { Cidade, RegrasNegocio } from "./esquema";

interface Municipio {
  nome: string;
  uf: string;
}

/** Estados (e jeitos comuns de falar). São Paulo e Rio de Janeiro são cidade e estado: decide o contexto. */
const ESTADOS: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA", ceara: "CE", "distrito federal": "DF",
  "espirito santo": "ES", goias: "GO", maranhao: "MA", "mato grosso": "MT", "mato grosso do sul": "MS",
  minas: "MG", "minas gerais": "MG", para: "PA", paraiba: "PB", parana: "PR", pernambuco: "PE", piaui: "PI",
  "rio grande do norte": "RN", "rio grande do sul": "RS", rondonia: "RO", roraima: "RR", "santa catarina": "SC",
  sergipe: "SE", tocantins: "TO",
};

/** Município cujo nome é palavra comum: só conta com a UF escrita. */
const PALAVRA_COMUM = new Set([
  "bonito", "formosa", "alegre", "esperanca", "natal", "vitoria", "serra", "central", "luz", "paraiso", "saudade",
  "barra", "palmas", "porto", "castelo", "lagoa", "mata", "cruz", "gloria", "feliz", "areia", "brejo", "santana",
  "campos", "vale", "praia", "ilha", "rio", "jardim", "planalto", "centro", "bela vista", "boa vista", "nova",
  "sao jose", "santa rita", "bom jesus", "agua boa", "cascata", "colina", "aurora", "bandeira", "cachoeira", "sobral",
  "anta", "quatis", "pedra", "salto", "alianca", "liberdade", "fortaleza", "pacoti", "cristal", "mirante", "oriente",
  "general", "presidente", "silva", "costa", "lima", "freitas", "souza", "barbosa", "marcos", "patos", "garca",
]);

const CONECTOR = new Set(["em", "de", "da", "do", "no", "na", "pra", "para", "cidade", "fica", "moro", "mora", "sou", "obra", "ate", "perto", "regiao", "lado"]);

let indice: Map<string, Municipio[]> | null = null;
function municipios(): Map<string, Municipio[]> {
  if (indice) return indice;
  indice = new Map();
  for (const linha of MUNICIPIOS.split("\n")) {
    const [nome, uf] = linha.split(";");
    const k = normalizarTexto(nome);
    const l = indice.get(k) ?? [];
    l.push({ nome, uf });
    indice.set(k, l);
  }
  return indice;
}

export interface LugarAchado {
  tipo: "municipio" | "bairro";
  cidade: Cidade;
  /** Nome do bairro, quando é bairro. */
  bairro?: string;
  /** Posição no texto normalizado. */
  pos: number;
}

function posicoes(palavras: string[]): number[] {
  const out: number[] = [];
  let p = 0;
  for (const w of palavras) {
    out.push(p);
    p += w.length + 1;
  }
  return out;
}

/** Bairros das cidades atendidas que aparecem no texto (já normalizado). */
export function bairrosNoTexto(regras: RegrasNegocio, t: string): LugarAchado[] {
  const out: LugarAchado[] = [];
  for (const c of regras.cidadesAtendidas) {
    const lista = BAIRROS[`${c.cidade}/${c.uf || "SP"}`] ?? [];
    for (const b of lista) {
      const n = normalizarTexto(b);
      const re = new RegExp(`(?:^|\\s)${n.replace(/ /g, "\\s+")}(?=\\s|$)`, "g");
      for (const m of t.matchAll(re)) out.push({ tipo: "bairro", cidade: { cidade: c.cidade, uf: c.uf }, bairro: b, pos: (m.index ?? 0) + (m[0].startsWith(" ") ? 1 : 0) });
    }
  }
  return out;
}

/**
 * Municípios citados sem a UF ("a obra é em Sorocaba"). Só com conector antes ("em", "de",
 * "na", "moro"...), nunca nome de estado nem palavra comum. Nome repetido em vários estados:
 * fica o da UF das cidades atendidas, se existir; senão não dá pra saber e não conta.
 */
export function municipiosNoTexto(regras: RegrasNegocio, t: string): LugarAchado[] {
  const idx = municipios();
  const palavras = t.split(" ").filter(Boolean);
  const pos = posicoes(palavras);
  const ufs = new Set(regras.cidadesAtendidas.map((c) => c.uf || "SP"));
  const out: LugarAchado[] = [];
  for (let i = 0; i < palavras.length; i++) {
    if (i === 0 || !CONECTOR.has(palavras[i - 1])) continue;
    for (let n = Math.min(6, palavras.length - i); n >= 1; n--) {
      const nome = palavras.slice(i, i + n).join(" ");
      if (nome.length < 4 || PALAVRA_COMUM.has(nome) || ESTADOS[nome]) continue;
      // "estado de São Paulo", "interior de SP": é o estado.
      if ((nome === "sao paulo" || nome === "rio de janeiro") && /\b(estado|interior)\s+(de|do)\s*$/.test(t.slice(0, pos[i]))) continue;
      const l = idx.get(nome);
      if (!l) continue;
      const m = l.length === 1 ? l[0] : l.find((x) => ufs.has(x.uf));
      if (m) out.push({ tipo: "municipio", cidade: { cidade: m.nome, uf: m.uf }, pos: pos[i] });
      i += n - 1;
      break;
    }
  }
  return out;
}
