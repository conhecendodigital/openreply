/**
 * Estágio do lead no CRM (06/10/2026, pedido do dono: "classificação do lead
 * automática, se é qualificado ou não, de acordo com as regras do agente, não
 * só do Robério mas de qualquer pessoa").
 *
 * Genérico: os critérios são as REGRAS DURAS e a FICHA de cada número (o que
 * saiu do briefing de cada cliente). Nada fixo de um negócio.
 *
 * O motor recalcula a cada mensagem do contato, por regra sempre que dá (a
 * verificação de lib/whatsapp/regras/verificar.ts). Sem regra nenhuma, usa o
 * que a própria resposta do agente disse (qualificado ou não): nenhuma
 * chamada de IA a mais.
 *
 * Mudança manual do dono vence e fica marcada: o agente só muda de novo
 * quando chega fato novo (um campo da ficha mudou).
 *
 * "Sem resposta" é calculado na leitura (a última mensagem é nossa e o
 * cliente sumiu há SEM_RESPOSTA_HORAS), sem job de varredura.
 */
import type { AgenteTipo } from "@/lib/whatsapp/agentes/types";
import { temRegras, type RegrasNegocio } from "./esquema";
import type { Verificacao } from "./verificar";

export const ESTAGIOS = ["novo", "qualificando", "qualificado", "analisar", "fora_do_perfil", "cliente", "sem_resposta"] as const;
export type Estagio = (typeof ESTAGIOS)[number];
export type TipoForaDoPerfil = "regiao" | "servico" | "outro";

export const SEM_RESPOSTA_HORAS = 48;

/** Nome padrão (chave do i18n, em inglês; a tela traduz). */
export const NOME_ESTAGIO: Record<Estagio, string> = {
  novo: "New",
  qualificando: "Qualifying",
  qualificado: "Qualified",
  analisar: "To review",
  fora_do_perfil: "Out of profile",
  cliente: "Customer or after-sales",
  sem_resposta: "No reply",
};

export function estagioValido(v: unknown): v is Estagio {
  return typeof v === "string" && (ESTAGIOS as readonly string[]).includes(v);
}

export interface ConfigEstagio {
  nome: string;
  oculto: boolean;
}

/** Nomes e estágios ocultos do número (WaAgentProfile.estagiosLead). */
export function lerConfigEstagios(v: unknown): Record<Estagio, ConfigEstagio> {
  const out = {} as Record<Estagio, ConfigEstagio>;
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  for (const e of ESTAGIOS) {
    const x = o[e] && typeof o[e] === "object" ? (o[e] as Record<string, unknown>) : {};
    const nome = typeof x.nome === "string" ? x.nome.replace(/\s+/g, " ").trim().slice(0, 40) : "";
    out[e] = { nome, oculto: x.oculto === true && e !== "novo" };
  }
  return out;
}

export interface Classificacao {
  estagio: Estagio;
  motivo: string;
  tipo: TipoForaDoPerfil | null;
}

/**
 * Estágio a partir da verificação (regras + ficha). `qualificadoPeloModelo` só
 * vale quando o número não tem regra nenhuma.
 */
export function classificarLead(e: {
  regras: RegrasNegocio | null | undefined;
  verificacao: Verificacao | null;
  agente: AgenteTipo;
  qualificadoPeloModelo: boolean;
  resumoQualificado?: string;
}): Classificacao {
  if (e.agente === "suporte") return { estagio: "cliente", motivo: "já é cliente ou assunto de pós-venda", tipo: null };
  const v = e.verificacao;
  if (!temRegras(e.regras) || !v) {
    return e.qualificadoPeloModelo
      ? { estagio: "qualificado", motivo: e.resumoQualificado || "o agente marcou como qualificado", tipo: null }
      : { estagio: "qualificando", motivo: "conversa em andamento", tipo: null };
  }
  if (v.decisao === "qualificar") return { estagio: "qualificado", motivo: e.resumoQualificado || v.motivo, tipo: null };
  if (v.decisao === "analisar") return { estagio: "analisar", motivo: v.motivo, tipo: null };
  if (v.local.status === "fora" && !v.excecaoLocal) return { estagio: "fora_do_perfil", motivo: v.motivo, tipo: "regiao" };
  if (v.servico.status === "recusado") return { estagio: "fora_do_perfil", motivo: v.motivo, tipo: "servico" };
  if (v.local.status === "cuidado") return { estagio: "analisar", motivo: v.motivo || "região que vai pra análise", tipo: null };
  return { estagio: "qualificando", motivo: v.faltando.length ? `falta: ${v.faltando.map((f) => f.rotulo).join(", ")}` : "conversa em andamento", tipo: null };
}

export interface EstagioAtual {
  estagio: Estagio | null;
  manual: boolean;
  motivo: string | null;
}

/**
 * O que gravar. null = não muda (igual ao atual, ou o dono mudou na mão e não
 * chegou fato novo).
 */
export function decidirMudanca(atual: EstagioAtual, nova: Classificacao, fatoNovo: boolean): Classificacao | null {
  if (atual.manual && !fatoNovo) return null;
  if (atual.estagio === nova.estagio && (atual.motivo ?? "") === nova.motivo && !atual.manual) return null;
  if (atual.manual && atual.estagio === nova.estagio) return null;
  return nova;
}

/** Estágio que a tela mostra ("sem resposta" é calculado aqui). */
export function estagioNaTela(
  gravado: string | null | undefined,
  ultima: { fromMe: boolean; sentAt: Date } | null,
  now: Date
): Estagio {
  const e: Estagio = estagioValido(gravado) ? gravado : "novo";
  if ((e === "novo" || e === "qualificando") && ultima?.fromMe && now.getTime() - ultima.sentAt.getTime() > SEM_RESPOSTA_HORAS * 3600_000) {
    return "sem_resposta";
  }
  return e;
}
