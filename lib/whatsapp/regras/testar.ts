/**
 * "Testar o agente": os casos de teste do briefing viram conversas simuladas.
 *
 * Pra cada caso, um modelo faz o papel do cliente (a partir da situação do
 * caso) e o agente de qualificação responde do jeito de sempre: mesmo
 * Comando, mesmas regras duras, mesma verificação e a mesma correção (uma
 * vez). Até MAX_TURNOS trocas. No fim, a decisão do motor é comparada com a
 * decisão esperada do caso: passou ou falhou, e quais regras foram quebradas.
 *
 * Nada é gravado em conversa nem enviado pra ninguém. O gasto vai pra Gastos
 * de IA (kind "teste") e cada chamada confere o teto antes.
 */
import { montarComando, lerSaida, type SaidaAgente } from "@/lib/whatsapp/agentes/comando";
import { quebrarEmBolhas } from "@/lib/whatsapp/agentes/bolhas";
import { custoMaximoUsdMicro, custoUsdMicro, type Preco } from "@/lib/whatsapp/agentes/modelos";
import type { ChamarModelo, MensagemChat } from "@/lib/whatsapp/agentes/provedores";
import type { AgenteConfig, AgentProfile, IaProvider, Uso, WaMessageLite } from "@/lib/whatsapp/agentes/types";
import { DECISOES, type CasoTeste, type Decisao, type RegrasNegocio } from "./esquema";
import { detectarServico } from "./detectar";
import { camposDaFicha, fichaVazia, juntarFicha, preencherPorRegra } from "./ficha";
import { blocoFicha, blocoRegras, formatoExtra } from "./prompt";
import { localDaConversa, mensagemDeCorrecaoRegras, verificarResposta, type Verificacao } from "./verificar";

export const MAX_TURNOS = 4;
export const MAX_TOKENS_AGENTE = 600;
export const MAX_TOKENS_CLIENTE = 200;

export interface DepsTeste {
  chamar: ChamarModelo;
  provider: IaProvider;
  modelo: string;
  apiKey: string;
  precos?: Record<string, Preco>;
  /** false = o teto do dia não deixa (o teste para ali). */
  conferirTeto: (custoPrevistoUsdMicro: number) => Promise<boolean>;
  registrarUso: (u: { modelo: string; uso: Uso; custoUsdMicro: number }) => Promise<void>;
}

export interface RegraNoTeste {
  regra: string;
  aviso: string;
  /** A correção resolveu (a resposta não sairia errada). */
  corrigida: boolean;
}

export type Obtido = Decisao | "erro_regra" | "teto" | "erro";

export interface ResultadoCaso {
  situacao: string;
  esperado: Decisao[];
  obtido: Obtido;
  passou: boolean;
  motivo: string;
  conversa: Array<{ de: "cliente" | "agente"; texto: string }>;
  regras: RegraNoTeste[];
}

export interface ResultadoTeste {
  casos: ResultadoCaso[];
  passaram: number;
  total: number;
  custoUsdMicro: number;
  /** O teto do dia parou o teste no meio. */
  parouNoTeto: boolean;
}

export const SISTEMA_CLIENTE = `Você faz o papel de um CLIENTE escrevendo no WhatsApp pra uma empresa, num teste. Siga a situação do cliente.
Escreva como gente de verdade no WhatsApp: mensagens curtas, português do Brasil, sem formalidade.
Na primeira mensagem, conte o principal da situação de um jeito natural. Depois, responda só o que a empresa perguntar, sempre de acordo com a situação.
Se a empresa perguntar algo que a situação não diz (por exemplo, o seu nome), invente um dado simples e fictício. Nunca escreva telefone, e-mail ou documento.
Responda só com um JSON: {"mensagem": "..."}`;

function mensagemCliente(caso: CasoTeste, conversa: ResultadoCaso["conversa"]): string {
  const hist = conversa.map((c) => `${c.de === "cliente" ? "VOCÊ" : "EMPRESA"}: ${c.texto}`).join("\n");
  return `SITUAÇÃO DO CLIENTE: ${caso.situacao}\n\n${hist ? `CONVERSA ATÉ AGORA:\n${hist}\n\nEscreva a sua próxima mensagem.` : "Escreva a sua primeira mensagem."}`;
}

function lerMensagemCliente(texto: string): string {
  const ini = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  if (ini >= 0 && fim > ini) {
    try {
      const d = JSON.parse(texto.slice(ini, fim + 1)) as { mensagem?: unknown };
      if (typeof d.mensagem === "string") return d.mensagem.trim().slice(0, 600);
    } catch {
      // cai no texto cru
    }
  }
  return texto.trim().slice(0, 600);
}

function obtidoDa(v: Verificacao): Obtido | null {
  if (v.violacoes.length) return "erro_regra";
  if (v.decisao === "continuar") return null;
  return v.decisao;
}

async function rodarCaso(caso: CasoTeste, e: { regras: RegrasNegocio; profile: AgentProfile; config: AgenteConfig }, deps: DepsTeste, gasto: { micro: number; teto: boolean }): Promise<ResultadoCaso> {
  const conversa: ResultadoCaso["conversa"] = [];
  const historico: WaMessageLite[] = [];
  const regrasQuebradas: RegraNoTeste[] = [];
  const defs = camposDaFicha(e.regras);
  let ficha = fichaVazia();
  let seq = 0;
  const base = new Date("2026-01-01T12:00:00Z").getTime();
  const msg = (fromMe: boolean, body: string): WaMessageLite => ({
    id: `t${++seq}`,
    fromMe,
    sentBy: fromMe ? "AGENT" : "CONTACT",
    type: "text",
    body,
    sentAt: new Date(base + seq * 60_000),
  });

  const chamar = async (sistemaFixo: string, sistemaVariavel: string, mensagens: MensagemChat[], maxTokens: number): Promise<string | null> => {
    const chars = sistemaFixo.length + sistemaVariavel.length + mensagens.reduce((n, m) => n + m.content.length, 0);
    if (!(await deps.conferirTeto(custoMaximoUsdMicro(deps.modelo, chars, maxTokens, deps.precos)))) {
      gasto.teto = true;
      return null;
    }
    const r = await deps.chamar({ provider: deps.provider, modelo: deps.modelo, apiKey: deps.apiKey, sistemaFixo, sistemaVariavel, mensagens, maxTokens, chaveCache: "wa-teste" });
    const custo = custoUsdMicro(deps.modelo, r.uso, deps.precos);
    gasto.micro += custo;
    await deps.registrarUso({ modelo: deps.modelo, uso: r.uso, custoUsdMicro: custo });
    return r.texto;
  };

  const fim = (obtido: Obtido, motivo: string): ResultadoCaso => ({
    situacao: caso.situacao,
    esperado: caso.esperado,
    obtido,
    passou: (DECISOES as readonly string[]).includes(obtido) && caso.esperado.includes(obtido as Decisao),
    motivo,
    conversa,
    regras: regrasQuebradas,
  });

  try {
    for (let turno = 0; turno < MAX_TURNOS; turno++) {
      const c = await chamar(SISTEMA_CLIENTE, "", [{ role: "user", content: mensagemCliente(caso, conversa) }], MAX_TOKENS_CLIENTE);
      if (c === null) return fim("teto", "o teto de gasto do dia parou o teste");
      const textoCliente = lerMensagemCliente(c);
      conversa.push({ de: "cliente", texto: textoCliente });
      historico.push(msg(false, textoCliente));

      // Ficha por regra (no teste, sem a chamada barata).
      const local0 = localDaConversa(e.regras, historico, ficha, defs);
      ficha = juntarFicha(
        ficha,
        preencherPorRegra(defs, { regras: e.regras, historico, local: local0, servico: detectarServico(e.regras, historico), nomesDoContato: { name: null, pushName: null }, now: new Date(base) }),
        new Date(base)
      ).ficha;
      const fb = blocoFicha(ficha, defs);
      const comando = montarComando({
        agente: e.config.agente,
        config: e.config,
        profile: e.profile,
        trechos: [],
        memoria: null,
        historico,
        nomesDoContato: [],
        extras: { regras: blocoRegras(e.regras, e.profile.baseCommand), formato: formatoExtra(e.regras), sabe: fb.sabe, falta: fb.falta },
      });
      const t1 = await chamar(comando.sistemaFixo, comando.sistemaVariavel, comando.mensagens, MAX_TOKENS_AGENTE);
      if (t1 === null) return fim("teto", "o teto de gasto do dia parou o teste");
      let saida: SaidaAgente | null = lerSaida(t1);
      if (!saida) return fim("erro", "a IA devolveu uma resposta fora do formato");
      const verificar = (s: SaidaAgente) =>
        verificarResposta({ regras: e.regras, agente: e.config.agente, historico, saida: { ...s, bolhas: quebrarEmBolhas(s.bolhas) }, ficha, defs, nomesDoContato: [] });
      let v = verificar(saida);
      if (v.violacoes.length) {
        const primeiras = v.violacoes;
        const t2 = await chamar(
          comando.sistemaFixo,
          comando.sistemaVariavel,
          [...comando.mensagens, { role: "assistant", content: t1.slice(0, 4000) }, { role: "user", content: mensagemDeCorrecaoRegras(primeiras) }],
          MAX_TOKENS_AGENTE
        );
        const s2 = t2 ? lerSaida(t2) : null;
        if (s2) {
          saida = s2;
          v = verificar(s2);
        }
        const ainda = new Set(v.violacoes.map((x) => x.regra));
        for (const p of primeiras) regrasQuebradas.push({ regra: p.regra, aviso: p.paraDono, corrigida: !ainda.has(p.regra) });
        for (const x of v.violacoes) if (!primeiras.some((p) => p.regra === x.regra)) regrasQuebradas.push({ regra: x.regra, aviso: x.paraDono, corrigida: false });
      }
      const bolhas = quebrarEmBolhas(saida.bolhas);
      conversa.push({ de: "agente", texto: bolhas.join("\n") });
      historico.push(msg(true, bolhas.join("\n")));
      const obtido = obtidoDa(v);
      if (obtido) return fim(obtido, v.violacoes.length ? v.violacoes.map((x) => x.paraDono).join(" ") : v.motivo);
    }
    return fim("continuar", "o agente seguiu perguntando até o fim do teste");
  } catch {
    return fim("erro", "a IA não respondeu (erro do provedor)");
  }
}

/** Roda os casos de teste (até 6 ao mesmo tempo) e devolve passou/falhou por caso. */
export async function testarAgente(
  e: { regras: RegrasNegocio; profile: AgentProfile; config: AgenteConfig; casos?: CasoTeste[] },
  deps: DepsTeste
): Promise<ResultadoTeste> {
  const casos = (e.casos ?? e.regras.casosTeste).slice(0, 12);
  const gasto = { micro: 0, teto: false };
  const resultados: ResultadoCaso[] = [];
  for (let i = 0; i < casos.length; i += 6) {
    const lote = await Promise.all(casos.slice(i, i + 6).map((c) => rodarCaso(c, e, deps, gasto)));
    resultados.push(...lote);
  }
  return {
    casos: resultados,
    passaram: resultados.filter((r) => r.passou).length,
    total: resultados.length,
    custoUsdMicro: gasto.micro,
    parouNoTeto: gasto.teto,
  };
}
