/**
 * Formato que a IA devolve no "Treinar com um documento" (validado com zod) e
 * o rascunho que a tela Agentes recebe. Sem banco e sem segredo aqui: dá pra
 * usar no servidor, na tela e nos testes.
 */
import { z } from "zod";

export const AGENTES_TREINO = ["qualificacao", "atendimento", "suporte"] as const;
export type AgenteTreino = (typeof AGENTES_TREINO)[number];

/** Limites dos campos da tela (lib/whatsapp/painel.ts saveAgents). */
export const LIMITE_COMANDO_BASE = 8000;
export const LIMITE_INSTRUCOES = 4000;
export const LIMITE_FATO = 300;
export const LIMITE_FATOS = 30;

const texto = z.string().default("");
const lista = <T extends z.ZodTypeAny>(item: T) => z.array(item).default([]);

export const TIPOS_MENSAGEM = ["boas_vindas", "encaminhamento", "fora_do_horario", "encerramento", "outra"] as const;
export type TipoMensagem = (typeof TIPOS_MENSAGEM)[number];

export const ONDE_REGRA = ["comando_base", ...AGENTES_TREINO] as const;

/** Resposta da IA. Campo a mais é ignorado; campo de lista que falta vira lista vazia. */
export const RespostaIaSchema = z.object({
  comando_base: z.string().min(1),
  fatos: lista(z.string()),
  instrucoes: z.object({
    qualificacao: texto,
    atendimento: texto,
    suporte: texto,
  }),
  horario_silencio: z
    .object({ inicio: z.string(), fim: z.string() })
    .nullable()
    .default(null),
  atraso_segundos: z
    .object({ de: z.number().int().min(0).max(600), ate: z.number().int().min(0).max(600) })
    .nullable()
    .default(null),
  limite_diario: z.number().int().min(0).max(1000).nullable().default(null),
  mensagens_aprovadas: lista(
    z.object({
      tipo: z.enum(TIPOS_MENSAGEM).catch("outra"),
      quando: texto,
      texto: z.string().min(1),
    })
  ),
  exemplos_de_fala: lista(z.string().min(1)),
  pendencias: lista(z.object({ assunto: z.string().min(1), trecho: texto })),
  regras_so_instrucao: lista(z.object({ regra: z.string().min(1), onde: z.enum(ONDE_REGRA).catch("comando_base") })),
  contradicoes: lista(z.object({ descricao: z.string().min(1) })),
  casos_de_teste: lista(z.object({ situacao: z.string().min(1), decisao: z.string().min(1), motivo: texto })),
});
export type RespostaIa = z.infer<typeof RespostaIaSchema>;

/** Campos da tela que o rascunho preencheu (pra marcar "Veio do documento"). */
export type CampoTreino =
  | "baseCommand"
  | "facts"
  | "quietHours"
  | "delay"
  | "maxAutoPerDay"
  | `agent:${AgenteTreino}`;

export interface RascunhoTreino {
  arquivo: { nome: string; tipo: "pdf" | "docx"; caracteres: number; cortado: boolean };
  profile: {
    baseCommand: string;
    facts: string[];
    quietStart: string | null;
    quietEnd: string | null;
    delayMinSeconds: number | null;
    delayMaxSeconds: number | null;
    maxAutoPerDay: number | null;
  };
  agents: Record<AgenteTreino, string>;
  doDocumento: CampoTreino[];
  mensagensAprovadas: Array<{ tipo: TipoMensagem; quando: string; texto: string; literal: boolean }>;
  casosDeTeste: Array<{ situacao: string; decisao: string; motivo: string }>;
  revisar: {
    pendencias: Array<{ assunto: string; trecho: string }>;
    soInstrucao: Array<{ regra: string; onde: (typeof ONDE_REGRA)[number] }>;
    contradicoes: Array<{ descricao: string }>;
    /** Número, preço, prazo ou horário que aparece num campo e não no documento. */
    naoAchei: Array<{ campo: string; valor: string }>;
    /** Texto em inglês (chave do i18n); {agent} = nome do agente. */
    avisos: Array<{ texto: string; agente?: AgenteTreino }>;
  };
}
