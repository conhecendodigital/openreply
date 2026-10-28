/**
 * Ficha do lead (29/10/2026): o que o vendedor SABE da pessoa. Puro, sem banco.
 *
 * REGRA DURA: só entra fato que a pessoa disse ou mostrou. A IA devolve cada campo com um trecho de
 * EVIDÊNCIA; o código só aceita se esse trecho existir, literalmente, numa fonte dela (DM, comentário ou
 * quiz). Sem evidência = descarta. Campo do dono nunca é sobrescrito, e nada é apagado.
 * Dado sensível (saúde, CPF, contato) é descartado. Nada disso vai para log.
 */
import { normalizarTexto } from "@/lib/whatsapp/regras/texto";
import { assuntoSensivel } from "./regras";

export const ORIGENS = ["dito_pela_pessoa", "comentario", "etiqueta", "quiz", "perfil_oficial", "dono"] as const;
export type Origem = (typeof ORIGENS)[number];

export const CAMPOS_TEXTO = ["negocio", "oQueFaz", "local", "dor", "objetivo", "objecoes"] as const;
export type CampoTexto = (typeof CAMPOS_TEXTO)[number];
export type NomeCampo = CampoTexto | "seguidores";

export const ROTULOS: Record<NomeCampo, string> = {
  negocio: "Negócio/nicho",
  oQueFaz: "O que faz",
  local: "Onde mora",
  dor: "Dor",
  objetivo: "Objetivo",
  objecoes: "Objeções ditas",
  seguidores: "Seguidores",
};

export const ESTAGIOS = ["novo", "entendendo", "viu_valor", "recebeu_link", "sumiu", "comprou"] as const;
export type Estagio = (typeof ESTAGIOS)[number];
/** Ordem do funil que o CÓDIGO pode avançar sozinho. sumiu e comprou são fora da linha (derivado / dono). */
const LINHA: Estagio[] = ["novo", "entendendo", "viu_valor", "recebeu_link"];

export type Campo = { valor: string; origem: Origem; evidencia?: string; em: string };
export type Ficha = { campos: Partial<Record<NomeCampo, Campo>>; estagio: Estagio };
export type Fonte = { origem: "dito_pela_pessoa" | "comentario" | "quiz"; texto: string };

export const MAX_VALOR = 140;
export const MAX_EVIDENCIA = 200;
export const SUMIU_APOS_MS = 48 * 3_600_000;

export function fichaVazia(): Ficha {
  return { campos: {}, estagio: "novo" };
}

function norm(s: string): string {
  return normalizarTexto(s).replace(/\s+/g, " ").trim();
}

const DADO_PESSOAL = /\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[.\s-]?\d{2}|\d{8,}|@[\w.]+\.[a-z]{2,}|https?:\/\//i;

export function valorSeguro(s: string): boolean {
  return !assuntoSensivel(s) && !DADO_PESSOAL.test(s);
}

function limpar(s: unknown, max: number): string {
  return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** A origem da 1ª fonte que contém a evidência literal (ignora acento, caixa e espaços). null = não achou. */
export function acharEvidencia(evidencia: string, fontes: Fonte[]): Fonte["origem"] | null {
  const e = norm(evidencia);
  if (e.length < 3) return null;
  for (const f of fontes) if (norm(f.texto).includes(e)) return f.origem;
  return null;
}

export type Extracao = Partial<Record<CampoTexto, { valor: string; evidencia: string }>>;

/** Lê o objeto `ficha_atualizada` da IA e devolve só o que tem evidência literal e é seguro. */
export function validarExtracao(bruto: unknown, fontes: Fonte[], now: Date): Partial<Record<CampoTexto, Campo>> {
  const out: Partial<Record<CampoTexto, Campo>> = {};
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return out;
  const obj = bruto as Record<string, unknown>;
  for (const nome of CAMPOS_TEXTO) {
    const c = obj[nome];
    if (!c || typeof c !== "object") continue;
    const valor = limpar((c as Record<string, unknown>).valor, MAX_VALOR);
    const evidencia = limpar((c as Record<string, unknown>).evidencia, MAX_EVIDENCIA);
    if (!valor || !evidencia) continue;
    if (!valorSeguro(valor) || !valorSeguro(evidencia)) continue;
    const origem = acharEvidencia(evidencia, fontes);
    if (!origem) continue;
    out[nome] = { valor, origem, evidencia, em: now.toISOString() };
  }
  return out;
}

/** Junta novos campos na ficha. Dono nunca é sobrescrito; nada é apagado; objeções se acumulam. */
export function mesclar(ficha: Ficha, novos: Partial<Record<NomeCampo, Campo>>): Ficha {
  const campos = { ...ficha.campos };
  for (const nome of Object.keys(novos) as NomeCampo[]) {
    const novo = novos[nome];
    if (!novo) continue;
    const atual = campos[nome];
    if (atual?.origem === "dono" && novo.origem !== "dono") continue;
    if (!atual) {
      campos[nome] = novo;
      continue;
    }
    if (norm(atual.valor) === norm(novo.valor)) continue;
    if (nome === "objecoes") {
      if (atual.valor.split(";").some((p) => norm(p) === norm(novo.valor))) continue;
      campos[nome] = { ...novo, valor: `${atual.valor}; ${novo.valor}`.slice(0, 300) };
    } else {
      campos[nome] = novo;
    }
  }
  return { ...ficha, campos };
}

/** Dado oficial do perfil (seguidores). Não passa por evidência: vem da API da Meta. */
export function comSeguidores(ficha: Ficha, seguidores: number | null, now: Date): Ficha {
  if (seguidores === null || ficha.campos.seguidores?.origem === "dono") return ficha;
  return mesclar(ficha, { seguidores: { valor: String(seguidores), origem: "perfil_oficial", em: now.toISOString() } });
}

/** Estágio só avança na linha do funil (nunca volta). `para` fora da linha é ignorado. */
export function avancarEstagio(atual: Estagio, para: Estagio | null | undefined): Estagio {
  if (!para) return atual;
  const i = LINHA.indexOf(atual);
  const j = LINHA.indexOf(para);
  if (i < 0 || j < 0) return atual;
  return j > i ? para : atual;
}

export function lerEstagio(v: unknown): Estagio | null {
  return typeof v === "string" && (ESTAGIOS as readonly string[]).includes(v) ? (v as Estagio) : null;
}

/** Estágio mostrado: quem recebeu o link e some por 48 h vira "sumiu" (derivado, não grava). */
export function estagioEfetivo(ficha: Ficha, ultimaMensagemDelaEm: Date | null, now: Date): Estagio {
  if (ficha.estagio === "recebeu_link" && ultimaMensagemDelaEm && now.getTime() - ultimaMensagemDelaEm.getTime() > SUMIU_APOS_MS) return "sumiu";
  return ficha.estagio;
}

export function ehEstagio(s: unknown): s is Estagio {
  return lerEstagio(s) !== null;
}

/** Lê a ficha que veio do banco (Json) sem confiar nela. */
export function lerFicha(campos: unknown, estagio: unknown): Ficha {
  const f = fichaVazia();
  f.estagio = lerEstagio(estagio) ?? "novo";
  if (campos && typeof campos === "object" && !Array.isArray(campos)) {
    for (const nome of [...CAMPOS_TEXTO, "seguidores"] as NomeCampo[]) {
      const c = (campos as Record<string, unknown>)[nome] as Record<string, unknown> | undefined;
      if (!c || typeof c.valor !== "string" || !c.valor) continue;
      const origem = (ORIGENS as readonly string[]).includes(c.origem as string) ? (c.origem as Origem) : "dito_pela_pessoa";
      f.campos[nome] = {
        valor: c.valor.slice(0, 300),
        origem,
        evidencia: typeof c.evidencia === "string" ? c.evidencia.slice(0, MAX_EVIDENCIA) : undefined,
        em: typeof c.em === "string" ? c.em : "",
      };
    }
  }
  return f;
}

const FALTA_ORDEM: CampoTexto[] = ["negocio", "oQueFaz", "dor", "objetivo", "local"];

/** Campos que ainda faltam, na ordem em que vale perguntar. */
export function camposFaltando(ficha: Ficha): CampoTexto[] {
  return FALTA_ORDEM.filter((c) => !ficha.campos[c]);
}

/** Texto da ficha para o cartão da pessoa (vai ao modelo dentro de <dados>). */
export function fichaParaCartao(ficha: Ficha | null): string {
  if (!ficha) return "";
  const linhas: string[] = [];
  for (const nome of [...CAMPOS_TEXTO, "seguidores"] as NomeCampo[]) {
    const c = ficha.campos[nome];
    if (c) linhas.push(`${ROTULOS[nome]}: ${c.valor} (origem: ${c.origem})`);
  }
  const falta = camposFaltando(ficha).map((c) => ROTULOS[c]);
  const cab = `FICHA DO LEAD (só fatos que a pessoa disse ou mostrou). Estágio: ${ficha.estagio}.`;
  return [cab, ...(linhas.length ? linhas : ["(ainda não sei nada dela além da conversa)"]), falta.length ? `Ainda falta saber: ${falta.join(", ")}.` : "A ficha está completa."].join("\n");
}

export type EdicaoDoDono = { estagio?: Estagio; campos?: Partial<Record<NomeCampo, string | null>> };

/** Edição do dono na tela: vira origem "dono" e passa a mandar. Texto vazio/null remove o campo. */
export function aplicarEdicaoDoDono(ficha: Ficha, edicao: EdicaoDoDono, now: Date): Ficha {
  const campos = { ...ficha.campos };
  for (const nome of [...CAMPOS_TEXTO, "seguidores"] as NomeCampo[]) {
    if (!edicao.campos || !(nome in edicao.campos)) continue;
    const v = limpar(edicao.campos[nome], 300);
    if (!v) delete campos[nome];
    else campos[nome] = { valor: v, origem: "dono", em: now.toISOString() };
  }
  return { campos, estagio: edicao.estagio ?? ficha.estagio };
}
