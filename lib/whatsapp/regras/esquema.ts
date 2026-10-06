/**
 * Regras duras do negócio, estruturadas (06/10/2026, pedido do dono: "o cara
 * só atende Paulínia e Campinas/SP, o cara não vai atender em outro lugar").
 *
 * Vêm do "Treinar com um documento" (a IA extrai do briefing) e são editáveis
 * na tela Agentes. Ficam em WaAgentProfile.regrasNegocio. O motor confere cada
 * resposta contra elas (lib/whatsapp/regras/verificar.ts) e o resumo entra
 * sempre no Comando (lib/whatsapp/regras/prompt.ts).
 *
 * Só mudam quando o dono clica em Salvar ou aceita uma sugestão. Nada aqui
 * grava nem chama IA: dá pra usar no servidor, na tela e nos testes.
 */
import { z } from "zod";

export const LIMITE_ITENS = 40;
export const LIMITE_TEXTO_CURTO = 160;
export const LIMITE_TEXTO = 600;
export const LIMITE_PALAVRAS = 20;
export const LIMITE_CASOS = 12;

/** O que o motor decide numa conversa. É também a decisão esperada de um caso de teste. */
export const DECISOES = ["qualificar", "analisar", "fora_da_area", "servico_recusado", "humano", "continuar"] as const;
export type Decisao = (typeof DECISOES)[number];

const curto = z.string().trim().max(LIMITE_TEXTO_CURTO).catch("");
const texto = z.string().trim().max(LIMITE_TEXTO).catch("");
const palavras = z
  .array(z.string())
  .catch([])
  .transform((l) => [...new Set(l.map((p) => p.trim().replace(/\s+/g, " ").slice(0, 60)).filter((p) => p.length >= 2))].slice(0, LIMITE_PALAVRAS));

/** Lista que nunca derruba a validação: item ruim sai, o resto fica. */
function lista<T extends z.ZodTypeAny>(item: T, max = LIMITE_ITENS) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((arr) => {
      const out: z.infer<T>[] = [];
      for (const x of arr) {
        const r = item.safeParse(x);
        if (r.success) out.push(r.data);
        if (out.length >= max) break;
      }
      return out;
    });
}

const Uf = z
  .string()
  .trim()
  .toUpperCase()
  .catch("")
  .transform((u) => (/^[A-Z]{2}$/.test(u) ? u : ""));

export const CidadeSchema = z.object({
  cidade: z.string().trim().min(2).max(80),
  uf: Uf.default(""),
});
export type Cidade = z.infer<typeof CidadeSchema>;

/** Bairro ou região que não é recusada, mas vai pra análise (ex.: Campo Grande, em Campinas). */
export const RegiaoCuidadoSchema = z.object({
  nome: z.string().trim().min(2).max(80),
  cidade: curto.default(""),
  uf: Uf.default(""),
  regra: texto.default(""),
});
export type RegiaoCuidado = z.infer<typeof RegiaoCuidadoSchema>;

/** Item com descrição e as palavras que mostram que ele apareceu na conversa. */
export const ItemSchema = z.object({
  descricao: z.string().trim().min(2).max(LIMITE_TEXTO_CURTO),
  palavras: palavras.default([]),
});
export type ItemRegra = z.infer<typeof ItemSchema>;

export const InfoMinimaSchema = z.object({
  campo: z.string().trim().min(2).max(80),
  pergunta: curto.default(""),
  palavras: palavras.default([]),
});
export type InfoMinima = z.infer<typeof InfoMinimaSchema>;

export const CasoTesteSchema = z.object({
  situacao: z.string().trim().min(2).max(LIMITE_TEXTO),
  decisao: texto.default(""),
  motivo: texto.default(""),
  /** Decisões que contam como acerto (ex.: obra fora da área pode ser "analisar" ou "fora_da_area"). */
  esperado: z
    .array(z.enum(DECISOES).catch("continuar"))
    .catch(["continuar"])
    .transform((l) => (l.length ? [...new Set(l)] : (["continuar"] as Decisao[]))),
});
export type CasoTeste = z.infer<typeof CasoTesteSchema>;

export const MensagemAprovadaSchema = z.object({
  quando: curto.default(""),
  texto: z.string().trim().min(1).max(LIMITE_TEXTO),
});

export const RegrasNegocioSchema = z.object({
  versao: z.literal(1).catch(1).default(1),
  cidadesAtendidas: lista(CidadeSchema).default([]),
  cidadesNaoAtendidas: lista(CidadeSchema).default([]),
  regioesCuidado: lista(RegiaoCuidadoSchema).default([]),
  /** Exceções de local que vão pra análise (ex.: obra grande fora da região). */
  excecoesLocal: lista(ItemSchema).default([]),
  servicosAceitos: lista(z.string().trim().min(2).max(LIMITE_TEXTO_CURTO)).default([]),
  servicosRecusados: lista(ItemSchema).default([]),
  /** Atendidos mesmo parecendo pedido pequeno (ex.: pedras, mármore, granito). */
  excecoesServico: lista(ItemSchema).default([]),
  infoMinima: lista(InfoMinimaSchema, 15).default([]),
  horario: texto.default(""),
  nuncaPrometer: lista(z.string().trim().min(2).max(LIMITE_TEXTO_CURTO), 20).default([]),
  mensagemForaDaArea: texto.default(""),
  mensagemServicoRecusado: texto.default(""),
  mensagensAprovadas: lista(MensagemAprovadaSchema, 10).default([]),
  casosTeste: lista(CasoTesteSchema, LIMITE_CASOS).default([]),
  /** O que o resumo pra equipe precisa ter (vira campo da ficha do lead). */
  resumoEquipe: lista(z.string().trim().min(2).max(80), 15).default([]),
  /** Quem recebe os leads qualificados (o telefone só serve pro aviso opcional). */
  responsavel: z
    .object({ nome: curto.default(""), telefone: z.string().trim().max(30).catch("").default("") })
    .catch({ nome: "", telefone: "" })
    .default({ nome: "", telefone: "" }),
});
export type RegrasNegocio = z.infer<typeof RegrasNegocioSchema>;

export function regrasVazias(): RegrasNegocio {
  return RegrasNegocioSchema.parse({});
}

/** Lê o JSON do banco ou da tela. Nunca joga erro: o que não serve vira vazio. */
export function lerRegras(v: unknown): RegrasNegocio {
  const r = RegrasNegocioSchema.safeParse(v && typeof v === "object" ? v : {});
  return r.success ? r.data : regrasVazias();
}

/** Tem alguma regra dura que o motor confere? (Sem nenhuma, o motor segue como antes.) */
export function temRegras(r: RegrasNegocio | null | undefined): r is RegrasNegocio {
  if (!r) return false;
  return Boolean(
    r.cidadesAtendidas.length ||
      r.cidadesNaoAtendidas.length ||
      r.regioesCuidado.length ||
      r.servicosRecusados.length ||
      r.infoMinima.length
  );
}

/** Tem alguma coisa pra mostrar ou pôr no Comando (inclui horário, mensagens e casos de teste)? */
export function regrasPreenchidas(r: RegrasNegocio | null | undefined): boolean {
  if (!r) return false;
  return (
    temRegras({ ...r }) ||
    Boolean(
      r.excecoesLocal.length ||
        r.servicosAceitos.length ||
        r.excecoesServico.length ||
        r.horario ||
        r.nuncaPrometer.length ||
        r.mensagemForaDaArea ||
        r.mensagemServicoRecusado ||
        r.mensagensAprovadas.length ||
        r.casosTeste.length
    )
  );
}

export function rotuloCidade(c: { cidade: string; uf?: string }): string {
  return c.uf ? `${c.cidade}/${c.uf}` : c.cidade;
}
