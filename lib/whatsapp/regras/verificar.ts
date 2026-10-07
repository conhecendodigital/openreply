/**
 * Verificação determinística da resposta do agente contra as regras duras
 * (antes de enviar e antes de marcar qualificado).
 *
 * Não confia no que a IA diz que decidiu: lê a conversa (texto e transcrição),
 * a ficha do lead e as regras, e decide sozinha se dá pra qualificar. O que
 * sair errado vira uma "violação" com duas explicações: uma pro modelo
 * corrigir (motor pede uma correção, uma vez) e outra pro dono (aviso no
 * rascunho, se a correção também falhar).
 */
import type { AgenteTipo, WaMessageLite } from "@/lib/whatsapp/agentes/types";
import { rotuloCidade, type Decisao, type RegrasNegocio } from "./esquema";
import {
  classificarLocalEscrito,
  detectarExcecaoLocal,
  detectarLocal,
  detectarServico,
  infoPresente,
  SINAIS_VAZIOS,
  type LocalDetectado,
  type ServicoDetectado,
  type SinaisModelo,
} from "./detectar";
import { valorDoTipo, type CampoFichaDef, type FichaLead } from "./ficha";
import { contemTermo, normalizarFrase, normalizarTexto } from "./texto";

export type CodigoRegra =
  | "qualificado_sem_local"
  | "qualificado_fora_da_area"
  | "qualificado_servico_recusado"
  | "qualificado_sem_info"
  | "confirmou_fora_da_area"
  | "confirmou_sem_local"
  | "recusa_seca"
  | "confirmou_servico_recusado"
  | "nao_perguntou_local"
  | "perguntou_de_novo"
  | "promessa"
  | "passou_fora_da_area"
  | "passou_servico_recusado"
  | "seguiu_fora_da_area"
  | "seguiu_servico_recusado";

export interface Violacao {
  regra: CodigoRegra;
  /** Pro modelo corrigir (vai na mensagem de correção). */
  paraModelo: string;
  /** Pro dono (aviso no rascunho e no relatório). */
  paraDono: string;
}

/** O que a resposta do modelo quer fazer. */
export type Intencao = "qualificar" | "analisar" | "pessoa" | "continuar";

export interface SaidaParaVerificar {
  bolhas: string[];
  passarPraHumano: boolean;
  qualificado: boolean;
  motivo: string;
  sinais?: SinaisModelo;
}

export interface EntradaVerificacao {
  regras: RegrasNegocio;
  agente: AgenteTipo;
  historico: WaMessageLite[];
  saida: SaidaParaVerificar;
  ficha: FichaLead;
  defs: CampoFichaDef[];
  nomesDoContato: string[];
}

export interface Verificacao {
  local: LocalDetectado;
  excecaoLocal: string | null;
  servico: ServicoDetectado;
  /** Informações mínimas que ainda faltam. */
  faltando: CampoFichaDef[];
  intencao: Intencao;
  decisao: Decisao;
  /** Por que (pro dono, pro estágio do lead e pro aviso). */
  motivo: string;
  violacoes: Violacao[];
}

/* --------------------------------- frases --------------------------------- */

const NEGACAO_ANTES = /\b(nao|nem|nunca|infelizmente nao|ainda nao)\b[^.?!]{0,12}$/;

/** Alguma ocorrência do padrão sem um "não" logo antes. */
function afirmativo(texto: string, re: RegExp): boolean {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  for (const m of texto.matchAll(g)) {
    const antes = texto.slice(Math.max(0, (m.index ?? 0) - 20), m.index ?? 0);
    if (!NEGACAO_ANTES.test(antes)) return true;
  }
  return false;
}

/** Verbo de "atender no local" (sem "fazer": "a gente faz reforma" fala do serviço, não do lugar). */
const VERBO_LOCAL = "(atendemos|atende|atendo|a gente atende|trabalhamos|a gente trabalha|chegamos|a gente chega|vamos atender|podemos atender|conseguimos atender|da pra atender|da para atender|atuamos)";
const VERBO_ATENDE = "(atendemos|atende|atendo|a gente atende|fazemos|faco|a gente faz|trabalhamos|a gente trabalha|chegamos|vamos atender|podemos atender|conseguimos atender|da pra atender|da para atender|atuamos)";
const CONFIRMA_LOCAL = [
  new RegExp(`\\b${VERBO_LOCAL}\\s+(sim|ai|la|ai sim|ai tambem|tambem|na sua cidade|na sua regiao|sua cidade|sua regiao|essa cidade|essa regiao|nessa cidade|nessa regiao|a sua cidade|a sua regiao|seu bairro|esse bairro|nesse bairro|voce|voces|todo lugar|toda a regiao|em todo)\\b`),
  new RegExp(`\\b(sim|claro|com certeza|certeza|pode sim|opa)\\b[^.?!\\n]{0,25}\\b${VERBO_LOCAL}\\b`),
];
const RECUSA = /\b(nao|infelizmente nao|ainda nao)\s+(atendemos|atende|atendo|trabalhamos|chegamos|cobrimos|fazemos atendimento|temos atendimento|ha atendimento|tem atendimento|vamos conseguir atender|conseguimos atender|podemos atender|atuamos|vamos atender)\b/;
const SUAVE = /\b(infelizmente|por enquanto|no momento|ainda|analis\w*|avali\w*|verific\w*|disponibilidade|sinto muito|poxa|que pena|agradec\w*|obrigad\w*|boa sorte|desculp\w*)\b/;
const CONFIRMA_SERVICO = /\b(fazemos|faz|faco|executamos|conseguimos fazer|consigo fazer|podemos fazer|a gente faz|atendemos|fazemos esse|faz esse)\s+(sim|esse|essa|isso|esse servico|esse tipo|esse tipo de servico)\b/;
const VERBO_SERVICO = "(fazemos|faz|faco|executamos|a gente faz|trocamos|consertamos|arrumamos|resolvemos|instalamos|fazemos a|fazemos o)";
const PROMESSA = /\b(garanto|garantimos|te garanto|prometo|prometemos|fica pronto em|sem custo nenhum|com certeza fica|pode ficar tranquil[oa] que (fica|termina|sai))\b/;

function frasesComPergunta(bolhas: string[]): string[] {
  const out: string[] = [];
  for (const b of bolhas) {
    for (const m of normalizarFrase(b).matchAll(/[^.!?\n]*\?/g)) out.push(normalizarTexto(m[0]));
  }
  return out.filter(Boolean);
}

const PERGUNTA_LOCAL = /\b(cidade|onde|bairro|local|regiao|endereco)\b/;
const PERGUNTA_DE: Partial<Record<CampoFichaDef["tipo"], RegExp>> = {
  cidade: /\b(qual|que|em que|de que|em qual)\s+(cidade|regiao)\b|\bonde\b[^?]{0,30}\b(obra|servico|fica|vai ser|sera)\b|\blocal da obra\b/,
  bairro: /\b(qual|que|em que)\s+bairro\b/,
  nome: /\b(seu nome|como (voce )?se chama|com quem (eu )?falo|qual (e )?o seu nome)\b/,
  imovel: /\b(tipo de imovel|casa ou (apartamento|apto)|(apartamento|apto) ou casa|e casa|e apartamento|e comercial)\b/,
};

function confirmouCidade(texto: string, cidade: string): boolean {
  const c = normalizarTexto(cidade.split("/")[0] ?? "");
  if (c.length < 3) return false;
  const re = new RegExp(`\\b${VERBO_ATENDE}\\b[^.?!\\n]{0,40}\\b${c}\\b|\\b${c}\\b[^.?!\\n]{0,30}\\b${VERBO_ATENDE}\\b`, "g");
  return afirmativo(texto, re);
}

function confirmouServico(texto: string, termo: string | null): boolean {
  if (afirmativo(texto, CONFIRMA_SERVICO)) return true;
  if (!termo) return false;
  const t = normalizarTexto(termo);
  if (t.length < 3) return false;
  return afirmativo(texto, new RegExp(`\\b${VERBO_SERVICO}\\b[^.?!\\n]{0,40}\\b${t}\\b`, "g"));
}

/* --------------------------------- decisão --------------------------------- */

export function intencaoDa(saida: SaidaParaVerificar): Intencao {
  if (saida.qualificado) return "qualificar";
  if (saida.passarPraHumano && (/analis|avalia|exce[cç]/i.test(saida.motivo) || Boolean(saida.sinais?.excecao?.trim()))) return "analisar";
  if (saida.passarPraHumano) return "pessoa";
  return "continuar";
}

function listaAtendidas(r: RegrasNegocio): string {
  const l = r.cidadesAtendidas.map(rotuloCidade);
  return l.length <= 1 ? (l[0] ?? "") : `${l.slice(0, -1).join(", ")} e ${l[l.length - 1]}`;
}

/** Onde é a obra: o que o dono escreveu na ficha ganha; senão a conversa; senão o que a ficha guardou antes. */
export function localDaConversa(
  regras: RegrasNegocio,
  historico: WaMessageLite[],
  ficha: FichaLead,
  defs: CampoFichaDef[],
  sinais: SinaisModelo = SINAIS_VAZIOS
): LocalDetectado {
  const cidade = valorDoTipo(ficha, defs, "cidade");
  const bairro = valorDoTipo(ficha, defs, "bairro");
  if (cidade?.origem === "dono" || bairro?.origem === "dono") return classificarLocalEscrito(regras, cidade?.valor ?? "", bairro?.valor ?? "");
  const l = detectarLocal(regras, historico, sinais);
  if (l.status !== "desconhecida") return l;
  if (cidade || bairro) return classificarLocalEscrito(regras, cidade?.valor ?? "", bairro?.valor ?? "");
  return l;
}

export function verificarResposta(e: EntradaVerificacao): Verificacao {
  const { regras, saida } = e;
  const sinais = saida.sinais ?? SINAIS_VAZIOS;
  const restringeLocal = regras.cidadesAtendidas.length > 0;
  let local = localDaConversa(regras, e.historico, e.ficha, e.defs, sinais);
  // Sem lista de cidades atendidas, só a lista de não atendidas restringe.
  if (!restringeLocal && local.status === "fora" && !local.naoAtendidaListada) local = { ...local, status: "atendida" };
  const fora = local.status === "fora";
  const cuidado = local.status === "cuidado";
  const semLocal = restringeLocal && local.status === "desconhecida";
  const excecaoLocal = fora ? detectarExcecaoLocal(regras, e.historico, sinais) : null;
  const servico = detectarServico(regras, e.historico, sinais);
  const recusado = servico.status === "recusado";

  const faltando = e.defs.filter(
    (d) =>
      d.obrigatorio &&
      !e.ficha.campos[d.chave] &&
      !(d.tipo === "cidade" && local.status !== "desconhecida") &&
      !(d.tipo === "bairro" && local.regiao) &&
      !infoPresente({ campo: d.rotulo, pergunta: d.pergunta, palavras: d.palavras }, e.historico, { local, servico, nomesDoContato: e.nomesDoContato }, sinais)
  );

  const texto = normalizarFrase(saida.bolhas.join("\n"));
  const intencao = intencaoDa(saida);
  const violacoes: Violacao[] = [];
  const cidade = local.cidade ?? "esse local";
  const atendidas = listaAtendidas(regras);
  const comoForaDaArea =
    regras.mensagemForaDaArea || "diga com gentileza que a empresa não atende essa região, agradeça o contato e encerre, sem pergunta nova e sem passar pra humano";
  const comoServicoRecusado =
    regras.mensagemServicoRecusado || "diga com educação que a empresa não faz esse tipo de serviço, conte numa frase o que ela faz e encerre, sem pergunta nova";

  // Texto da resposta.
  if (fora || cuidado) {
    if (
      CONFIRMA_LOCAL.some((re) => afirmativo(texto, re)) ||
      afirmativo(texto, CONFIRMA_SERVICO) ||
      (local.cidade && confirmouCidade(texto, local.cidade)) ||
      (local.regiao && confirmouCidade(texto, local.regiao))
    ) {
      violacoes.push({
        regra: "confirmou_fora_da_area",
        paraModelo: `Você deu a entender que atende ${local.regiao ?? cidade}${fora && atendidas ? `, mas as cidades atendidas são ${atendidas}` : ", que vai pra análise"}. Não confirme atendimento. ${fora ? comoForaDaArea : "Diga que vai passar pra equipe analisar."}`,
        paraDono: `Regra do negócio: a resposta confirmava atendimento em ${local.regiao ?? cidade}, que ${fora ? "não está entre as cidades atendidas" : "vai pra análise"}.`,
      });
    }
    const recusou = afirmativo(texto, RECUSA);
    if (recusou && (cuidado || !SUAVE.test(texto))) {
      violacoes.push({
        regra: "recusa_seca",
        paraModelo: cuidado
          ? `Nunca diga que ${local.regiao ?? "essa região"} não é atendida. Diga que vai passar pra equipe analisar o caso.`
          : `Você recusou de forma seca. ${comoForaDaArea}`,
        paraDono: cuidado ? `Regra do negócio: a resposta dizia que ${local.regiao ?? "a região"} não é atendida (deve ir pra análise).` : "Regra do negócio: a resposta recusava de forma seca um local fora da área.",
      });
    }
  }
  if (semLocal && CONFIRMA_LOCAL.some((re) => afirmativo(texto, re))) {
    violacoes.push({
      regra: "confirmou_sem_local",
      paraModelo: "Você confirmou atendimento antes de saber onde vai ser a obra. Não confirme nada ainda: pergunte em qual cidade vai ser a obra.",
      paraDono: "Regra do negócio: a resposta confirmava atendimento sem saber onde é a obra.",
    });
  }
  if (recusado && confirmouServico(texto, servico.termo)) {
    violacoes.push({
      regra: "confirmou_servico_recusado",
      paraModelo: `O cliente pediu ${servico.termo ?? "um serviço"} e a empresa não faz ${servico.descricao ?? "esse tipo de serviço"}. Não diga que faz. ${comoServicoRecusado}`,
      paraDono: `Regra do negócio: a resposta dizia que a empresa faz ${servico.termo ?? "um serviço"} (${servico.descricao ?? "serviço recusado"}).`,
    });
  }
  if (regras.nuncaPrometer.length && afirmativo(texto, PROMESSA)) {
    violacoes.push({
      regra: "promessa",
      paraModelo: `Você prometeu ou garantiu algo. Nunca prometa: ${regras.nuncaPrometer.join("; ")}. Tire a promessa e diga que isso é visto com a equipe.`,
      paraDono: "Regra do negócio: a resposta prometia ou garantia algo que a empresa não promete.",
    });
  }
  // Pergunta repetida: campo que o cliente já respondeu.
  const perguntas = frasesComPergunta(saida.bolhas);
  for (const d of e.defs) {
    const v = e.ficha.campos[d.chave];
    if (!v || v.origem === "inferido") continue;
    const re = PERGUNTA_DE[d.tipo];
    const repetiu = perguntas.some((p) => (re ? re.test(p) : d.tipo === "outro" && d.palavras.some((w) => contemTermo(p, w))));
    if (repetiu) {
      violacoes.push({
        regra: "perguntou_de_novo",
        paraModelo: `Você perguntou de novo "${d.rotulo}", que o cliente já respondeu (${v.valor}). Não repita: use o que ele já disse e pergunte só o que falta.`,
        paraDono: `A resposta perguntava de novo "${d.rotulo}", que o cliente já respondeu.`,
      });
      break;
    }
  }

  // Decisão.
  let decisao: Decisao = "continuar";
  let motivo = "";
  const motivoFora = `obra em ${cidade}${atendidas ? `, fora de ${atendidas}` : ", fora da área atendida"}`;
  const motivoServico = `pediu ${servico.termo ?? servico.descricao ?? "um serviço"}, que a empresa não faz`;
  const motivoAnalise = cuidado
    ? `${local.regiao}${local.cidade ? ` (${local.cidade})` : ""}: região que vai pra análise`
    : excecaoLocal
      ? `${excecaoLocal}${local.cidade ? ` em ${local.cidade}` : ""}`
      : saida.motivo || "caso que precisa de análise";

  if (intencao === "qualificar") {
    if (semLocal) {
      violacoes.push({
        regra: "qualificado_sem_local",
        paraModelo: "Você marcou qualificado sem saber onde vai ser a obra. Não marque qualificado nem passe pra humano. Pergunte, numa frase curta, em qual cidade vai ser a obra.",
        paraDono: "Regra do negócio: o agente quis qualificar sem saber onde é a obra.",
      });
    } else if (cuidado || (fora && excecaoLocal)) {
      decisao = "analisar";
      motivo = motivoAnalise;
    } else if (fora) {
      violacoes.push({
        regra: "qualificado_fora_da_area",
        paraModelo: `A obra é em ${cidade}, que não está entre as cidades atendidas (${atendidas}). Não marque qualificado, não passe pra humano e não confirme atendimento. ${comoForaDaArea}`,
        paraDono: `Regra do negócio: o agente quis qualificar uma obra em ${cidade}, fora de ${atendidas}.`,
      });
    } else if (recusado) {
      violacoes.push({
        regra: "qualificado_servico_recusado",
        paraModelo: `O cliente pediu ${servico.termo ?? "um serviço"} e a empresa não faz ${servico.descricao ?? "esse tipo de serviço"}. Não marque qualificado. ${comoServicoRecusado}`,
        paraDono: `Regra do negócio: o agente quis qualificar um pedido de ${servico.termo ?? "serviço"} que a empresa não faz.`,
      });
    } else if (faltando.length) {
      const prox = faltando[0];
      violacoes.push({
        regra: "qualificado_sem_info",
        paraModelo: `Ainda faltam informações pra qualificar: ${faltando.map((f) => f.rotulo).join(", ")}. Não marque qualificado nem passe pra humano. Pergunte só a próxima que falta: ${prox.pergunta || prox.rotulo}.`,
        paraDono: `Regra do negócio: o agente quis qualificar sem ${faltando.map((f) => f.rotulo).join(", ")}.`,
      });
    } else {
      decisao = "qualificar";
      motivo = "todas as informações mínimas, local e serviço atendidos";
    }
  } else if (intencao === "analisar" && fora && !excecaoLocal && !cuidado) {
    violacoes.push({
      regra: "passou_fora_da_area",
      paraModelo: `A obra é em ${cidade}, fora da área atendida (${atendidas}), e não é exceção. Não passe pra análise nem pra humano. ${comoForaDaArea}`,
      paraDono: `Regra do negócio: o agente quis passar pra análise uma obra em ${cidade}, fora de ${atendidas}. Fora da área é recusa.`,
    });
    decisao = "fora_da_area";
    motivo = motivoFora;
  } else if (intencao === "analisar" && recusado && !fora && !cuidado) {
    violacoes.push({
      regra: "passou_servico_recusado",
      paraModelo: `O cliente pediu ${servico.termo ?? "um serviço"} e a empresa não faz ${servico.descricao ?? "esse tipo de serviço"}. Não passe pra análise nem pra humano. ${comoServicoRecusado}`,
      paraDono: `Regra do negócio: o agente quis passar pra análise um pedido de ${servico.termo ?? "serviço"} que a empresa não faz.`,
    });
    decisao = "servico_recusado";
    motivo = motivoServico;
  } else if (intencao === "analisar") {
    decisao = "analisar";
    motivo = motivoAnalise;
  } else if (intencao === "pessoa") {
    decisao = "humano";
    motivo = saida.motivo || "pediu uma pessoa";
  } else {
    if (fora && !excecaoLocal) {
      decisao = "fora_da_area";
      motivo = motivoFora;
    } else if (recusado) {
      decisao = "servico_recusado";
      motivo = motivoServico;
    }
    // Recusa encerra: sem pergunta nova que estica a conversa.
    // "..., tá?" e "ok?" no fim são jeito de falar, não pergunta.
    const perguntasDeVerdade = perguntas.filter((p) => !/(^|[\s,])(ta|ok|okay|beleza|blz|certo|viu|combinado|ne)\s*\??\s*$/.test(p));
    if ((decisao === "fora_da_area" || decisao === "servico_recusado") && perguntasDeVerdade.length) {
      violacoes.push({
        regra: decisao === "fora_da_area" ? "seguiu_fora_da_area" : "seguiu_servico_recusado",
        paraModelo: `Não faça pergunta: ${decisao === "fora_da_area" ? comoForaDaArea : comoServicoRecusado}.`,
        paraDono:
          decisao === "fora_da_area"
            ? `Regra do negócio: a resposta seguia perguntando numa obra em ${cidade}, fora da área. Fora da área é recusa educada e encerra.`
            : "Regra do negócio: a resposta seguia perguntando num serviço que a empresa não faz. É recusa educada e encerra.",
      });
    }
    if (semLocal && e.agente === "qualificacao" && !perguntas.some((p) => PERGUNTA_LOCAL.test(p))) {
      violacoes.push({
        regra: "nao_perguntou_local",
        paraModelo: "Você ainda não sabe onde vai ser a obra. Pergunte em qual cidade vai ser a obra, numa frase curta no fim da resposta.",
        paraDono: "Regra do negócio: a resposta não perguntava onde é a obra.",
      });
    }
  }
  if (!motivo && fora && !excecaoLocal) motivo = motivoFora;
  if (!motivo && recusado) motivo = motivoServico;

  return { local, excecaoLocal, servico, faltando, intencao, decisao, motivo, violacoes };
}

/** Mensagem de correção pro modelo (uma vez). */
export function mensagemDeCorrecaoRegras(violacoes: Violacao[]): string {
  return `Sua resposta quebrou regras do negócio e NÃO foi enviada:\n${violacoes.map((v, i) => `${i + 1}. ${v.paraModelo}`).join("\n")}\nEscreva a resposta de novo seguindo essas regras, no mesmo formato JSON.`;
}

export function avisoDasViolacoes(violacoes: Violacao[]): string {
  return [...new Set(violacoes.map((v) => v.paraDono))].join(" ");
}
