/**
 * Do JSON da IA (snake_case, do "Treinar com um documento") às regras duras
 * estruturadas (lib/whatsapp/regras/esquema.ts). Sem IA: só valida e
 * normaliza. O que não serve sai; nada é inventado aqui.
 */
import { DECISOES, lerRegras, type Decisao, type RegrasNegocio } from "@/lib/whatsapp/regras/esquema";

type Bruto = Record<string, unknown>;

function obj(v: unknown): Bruto {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Bruto) : {};
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function itens(v: unknown) {
  return arr(v).map((x) => {
    const o = obj(x);
    return { descricao: str(o.descricao), palavras: arr(o.palavras).map(str) };
  });
}

/** Decisão esperada de um caso: a da IA, ou adivinhada pelo texto da decisão. */
export function esperadoDoCaso(c: { decisao: string; esperado?: string[] }): Decisao[] {
  const daIa = (c.esperado ?? []).filter((d): d is Decisao => (DECISOES as readonly string[]).includes(d));
  if (daIa.length) return [...new Set(daIa)];
  const t = c.decisao.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const out: Decisao[] = [];
  if (/analis|avalia/.test(t)) out.push("analisar");
  if (/qualific/.test(t)) out.push("qualificar");
  if (/disponibilidade|fora da (area|regiao)|cuidado sobre/.test(t)) out.push("fora_da_area");
  if (/nao (faz|executa|atende|trabalha)|servico nao|educad/.test(t) && !out.length) out.push("servico_recusado");
  if (/seguir|continuar/.test(t) && !out.length) out.push("continuar");
  return out.length ? out : ["continuar"];
}

export function regrasDaIa(
  bruto: unknown,
  extra: { casos: Array<{ situacao: string; decisao: string; motivo: string; esperado?: string[] }>; mensagens: Array<{ quando: string; texto: string }> }
): RegrasNegocio {
  const r = obj(bruto);
  const resp = obj(r.responsavel);
  return lerRegras({
    cidadesAtendidas: arr(r.cidades_atendidas),
    cidadesNaoAtendidas: arr(r.cidades_nao_atendidas),
    regioesCuidado: arr(r.regioes_cuidado),
    excecoesLocal: itens(r.excecoes_local),
    servicosAceitos: arr(r.servicos_aceitos).map(str),
    servicosRecusados: itens(r.servicos_recusados),
    excecoesServico: itens(r.excecoes_servico),
    infoMinima: arr(r.info_minima).map((x) => {
      const o = obj(x);
      return { campo: str(o.campo), pergunta: str(o.pergunta), palavras: arr(o.palavras).map(str) };
    }),
    horario: str(r.horario),
    nuncaPrometer: arr(r.nunca_prometer).map(str),
    mensagemForaDaArea: str(r.mensagem_fora_da_area),
    mensagemServicoRecusado: str(r.mensagem_servico_recusado),
    mensagensAprovadas: extra.mensagens,
    casosTeste: extra.casos.map((c) => ({ situacao: c.situacao, decisao: c.decisao, motivo: c.motivo, esperado: esperadoDoCaso(c) })),
    resumoEquipe: arr(r.resumo_equipe).map(str),
    responsavel: { nome: str(resp.nome), telefone: str(resp.telefone) },
  });
}
