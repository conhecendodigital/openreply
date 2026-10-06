/**
 * O que a conversa diz, lido por regra (sem IA): onde é a obra, qual serviço
 * a pessoa quer e quais informações mínimas já apareceram.
 *
 * Só as mensagens do CLIENTE contam (texto e o que foi lido da mídia: a
 * transcrição do áudio entra aqui). O que o modelo diz que entendeu
 * (local_obra, servico, coletado) só vale se aparecer no texto do cliente:
 * assim a IA não inventa uma cidade atendida.
 */
import { textoPlano } from "@/lib/whatsapp/agentes/comando";
import type { WaMessageLite } from "@/lib/whatsapp/agentes/types";
import { rotuloCidade, type Cidade, type InfoMinima, type RegrasNegocio } from "./esquema";
import { acharTermo, contemTermo, normalizarTexto, UFS } from "./texto";

/** O que o modelo disse que entendeu (campos extras do JSON da resposta). */
export interface SinaisModelo {
  localObra: { cidade: string; uf: string; bairro: string } | null;
  servico: "aceito" | "recusado" | "excecao" | "desconhecido" | null;
  excecao: string;
  coletado: Record<string, string>;
}

export const SINAIS_VAZIOS: SinaisModelo = { localObra: null, servico: null, excecao: "", coletado: {} };

export type StatusLocal = "atendida" | "cuidado" | "fora" | "desconhecida";

export interface LocalDetectado {
  status: StatusLocal;
  /** "Hortolândia/SP" */
  cidade: string | null;
  /** Região com cuidado que apareceu (ex.: "Campo Grande"). */
  regiao: string | null;
  /** Está na lista de cidades não atendidas. */
  naoAtendidaListada: boolean;
  fonte: "texto" | "modelo" | null;
  /** Mensagem do cliente onde o local apareceu. */
  msgId: string | null;
}

export interface ServicoDetectado {
  status: "aceito" | "recusado" | "excecao" | "desconhecido";
  /** A palavra que decidiu (ex.: "torneira", "granito"). */
  termo: string | null;
  descricao: string | null;
}

/** Texto de cada mensagem do cliente, normalizado, na ordem. */
export function textosDoCliente(historico: WaMessageLite[]): string[] {
  return historico.filter((m) => !m.fromMe).map((m) => normalizarTexto(textoPlano(m)));
}

/* ------------------------------------ local ------------------------------------ */

interface Mencao {
  tipo: "atendida" | "nao_atendida" | "cuidado" | "outra";
  cidade: Cidade | null;
  regiao: string | null;
  msg: number;
  msgId: string;
  pos: number;
  /** "moro em X": é onde a pessoa mora, não necessariamente a obra. */
  moradia: boolean;
  fonte: "texto" | "modelo";
}

const MORADIA = /\b(moro|mora|moramos|morando|resido|reside|residimos|sou de|somos de|eu sou de|vim de)\b[^.?!]{0,25}$/;
const CONECTORES = new Set(["em", "no", "na", "pra", "para", "fica", "sera", "e", "eh", "obra", "aqui", "cidade", "de", "da", "do", "mora", "moro", "sou", "a", "o", "que", "vai", "ser", "eu"]);
const MATO_GROSSO_DO_SUL = /^\s*(ms|mato grosso do sul|mato grosso)\b/;

function mesmaCidade(a: Cidade, nome: string, uf: string): boolean {
  if (normalizarTexto(a.cidade) !== normalizarTexto(nome)) return false;
  return !a.uf || !uf || a.uf === uf.toUpperCase();
}

function classificar(regras: RegrasNegocio, nome: string, uf: string): Mencao["tipo"] {
  if (regras.cidadesAtendidas.some((c) => mesmaCidade(c, nome, uf))) return "atendida";
  if (regras.cidadesNaoAtendidas.some((c) => mesmaCidade(c, nome, uf))) return "nao_atendida";
  return "outra";
}

/** "Sumaré/SP", "sumare - sp": cidade fora das listas, com UF. */
function cidadesComUf(textoOriginal: string): Array<{ cidade: string; uf: string; pos: number }> {
  const out: Array<{ cidade: string; uf: string; pos: number }> = [];
  const re = /((?:[A-Za-zÀ-ÿ'’]+\s+){0,4}[A-Za-zÀ-ÿ'’]+)\s*[/-]\s*([A-Za-z]{2})\b/g;
  for (const m of textoOriginal.matchAll(re)) {
    const uf = m[2].toUpperCase();
    if (!UFS.has(uf)) continue;
    const palavras = m[1].split(/\s+/);
    // Corta o que vem antes do nome ("a obra é em Sumaré" -> "Sumaré").
    let ini = 0;
    for (let i = 0; i < palavras.length - 1; i++) if (CONECTORES.has(normalizarTexto(palavras[i]))) ini = i + 1;
    const cidade = palavras.slice(ini).join(" ").replace(/^(de|da|do)\s+/i, "");
    if (cidade.length >= 3) out.push({ cidade, uf, pos: m.index ?? 0 });
  }
  return out;
}

function eMoradia(textoNormalizado: string, pos: number): boolean {
  return MORADIA.test(textoNormalizado.slice(Math.max(0, pos - 40), pos));
}

function mencoesNoTexto(regras: RegrasNegocio, historico: WaMessageLite[]): Mencao[] {
  const out: Mencao[] = [];
  const doCliente = historico.filter((m) => !m.fromMe);
  doCliente.forEach((m, msg) => {
    const original = textoPlano(m);
    const t = normalizarTexto(original);
    if (!t) return;
    const add = (x: Omit<Mencao, "msg" | "msgId" | "moradia" | "fonte">) => out.push({ ...x, msg, msgId: m.id, moradia: eMoradia(t, x.pos), fonte: "texto" });

    for (const r of regras.regioesCuidado) {
      for (const pos of acharTermo(t, r.nome)) {
        const depois = t.slice(pos + normalizarTexto(r.nome).length);
        // "Campo Grande/MS" é a cidade, não o bairro de Campinas.
        if (r.cidade && normalizarTexto(r.cidade) !== "campo grande" && MATO_GROSSO_DO_SUL.test(depois)) {
          add({ tipo: "outra", cidade: { cidade: r.nome, uf: "MS" }, regiao: null, pos });
          continue;
        }
        add({ tipo: "cuidado", cidade: r.cidade ? { cidade: r.cidade, uf: r.uf } : null, regiao: r.nome, pos });
      }
    }
    const regiaoEm = (pos: number) =>
      regras.regioesCuidado.some((r) => acharTermo(t, r.nome).some((p) => pos >= p && pos < p + normalizarTexto(r.nome).length));
    for (const c of regras.cidadesAtendidas) {
      for (const pos of acharTermo(t, c.cidade)) if (!regiaoEm(pos)) add({ tipo: "atendida", cidade: c, regiao: null, pos });
    }
    for (const c of regras.cidadesNaoAtendidas) {
      for (const pos of acharTermo(t, c.cidade)) if (!regiaoEm(pos)) add({ tipo: "nao_atendida", cidade: c, regiao: null, pos });
    }
    for (const x of cidadesComUf(original)) {
      const tipo = classificar(regras, x.cidade, x.uf);
      if (tipo !== "outra") continue; // já achada pelo nome acima
      if (regras.regioesCuidado.some((r) => normalizarTexto(r.nome) === normalizarTexto(x.cidade) && x.uf !== "MS")) continue;
      const pos = Math.max(0, t.indexOf(normalizarTexto(x.cidade)));
      add({ tipo: "outra", cidade: { cidade: x.cidade, uf: x.uf }, regiao: null, pos });
    }
  });
  return out.sort((a, b) => a.msg - b.msg || a.pos - b.pos);
}

/** A cidade que o modelo entendeu, se aparece mesmo no que o cliente escreveu ou falou. */
function mencaoDoModelo(regras: RegrasNegocio, historico: WaMessageLite[], sinais: SinaisModelo): Mencao | null {
  const lo = sinais.localObra;
  if (!lo) return null;
  const textos = textosDoCliente(historico);
  const ids = historico.filter((m) => !m.fromMe).map((m) => m.id);
  const bairro = lo.bairro?.trim() ?? "";
  if (bairro) {
    const r = regras.regioesCuidado.find((x) => normalizarTexto(x.nome) === normalizarTexto(bairro));
    const msg = textos.findIndex((t) => contemTermo(t, bairro));
    if (r && msg >= 0) return { tipo: "cuidado", cidade: r.cidade ? { cidade: r.cidade, uf: r.uf } : null, regiao: r.nome, msg, msgId: ids[msg], pos: 0, moradia: false, fonte: "modelo" };
  }
  const nome = lo.cidade?.trim() ?? "";
  if (normalizarTexto(nome).length < 3) return null;
  let msg = -1;
  for (let i = textos.length - 1; i >= 0; i--) if (contemTermo(textos[i], nome)) {
    msg = i;
    break;
  }
  if (msg < 0) return null;
  const uf = /^[A-Za-z]{2}$/.test(lo.uf ?? "") && UFS.has(lo.uf.toUpperCase()) ? lo.uf.toUpperCase() : "";
  const tipo = classificar(regras, nome, uf);
  const conhecida =
    regras.cidadesAtendidas.find((c) => mesmaCidade(c, nome, uf)) ?? regras.cidadesNaoAtendidas.find((c) => mesmaCidade(c, nome, uf));
  return { tipo, cidade: conhecida ?? { cidade: nome, uf }, regiao: null, msg, msgId: ids[msg], pos: 0, moradia: false, fonte: "modelo" };
}

const chave = (m: Mencao) => (m.cidade ? normalizarTexto(m.cidade.cidade) : "") + "|" + (m.regiao ? normalizarTexto(m.regiao) : "");

export function detectarLocal(regras: RegrasNegocio, historico: WaMessageLite[], sinais: SinaisModelo = SINAIS_VAZIOS): LocalDetectado {
  const mencoes = mencoesNoTexto(regras, historico);
  const doModelo = mencaoDoModelo(regras, historico, sinais);
  const daObra = mencoes.filter((m) => !m.moradia);

  let escolhida: Mencao | null = null;
  if (doModelo && (daObra.length === 0 || daObra.some((m) => chave(m) === chave(doModelo) || (doModelo.tipo === "cuidado" && m.tipo === "cuidado")))) {
    escolhida = doModelo;
  } else if (daObra.length) {
    escolhida = daObra[daObra.length - 1];
  }
  if (!escolhida) return LOCAL_DESCONHECIDO;

  // Região com cuidado citada pra obra ganha da cidade atendida ("Campo Grande, em Campinas").
  const cuidado = escolhida.tipo === "cuidado" ? escolhida : daObra.find((m) => m.tipo === "cuidado") ?? null;
  if (cuidado && escolhida.tipo !== "nao_atendida" && escolhida.tipo !== "outra") {
    return {
      status: "cuidado",
      cidade: cuidado.cidade ? rotuloCidade(cuidado.cidade) : escolhida.cidade ? rotuloCidade(escolhida.cidade) : null,
      regiao: cuidado.regiao,
      naoAtendidaListada: false,
      fonte: cuidado.fonte,
      msgId: cuidado.msgId,
    };
  }
  const cidade = escolhida.cidade ? rotuloCidade(escolhida.cidade) : null;
  if (escolhida.tipo === "atendida") return { status: "atendida", cidade, regiao: null, naoAtendidaListada: false, fonte: escolhida.fonte, msgId: escolhida.msgId };
  return { status: "fora", cidade, regiao: null, naoAtendidaListada: escolhida.tipo === "nao_atendida", fonte: escolhida.fonte, msgId: escolhida.msgId };
}

export const LOCAL_DESCONHECIDO: LocalDetectado = { status: "desconhecida", cidade: null, regiao: null, naoAtendidaListada: false, fonte: null, msgId: null };

/**
 * Classifica um local escrito à mão (ficha editada pelo dono, ou guardada de
 * mensagens antigas que já saíram do histórico): "Sumaré/SP", "Campo Grande, Campinas".
 */
export function classificarLocalEscrito(regras: RegrasNegocio, cidadeTexto: string, bairroTexto = ""): LocalDetectado {
  const falso: WaMessageLite = { id: "ficha", fromMe: false, sentBy: "CONTACT", type: "text", body: [bairroTexto, cidadeTexto].filter(Boolean).join(", "), sentAt: new Date(0) };
  const l = detectarLocal(regras, [falso]);
  if (l.status !== "desconhecida") return { ...l, msgId: null };
  const nome = cidadeTexto.split(/[/,-]/)[0]?.trim() ?? "";
  if (normalizarTexto(nome).length < 3) return LOCAL_DESCONHECIDO;
  const uf = (/[/-]\s*([A-Za-z]{2})\s*$/.exec(cidadeTexto)?.[1] ?? "").toUpperCase();
  const ufOk = UFS.has(uf) ? uf : "";
  const tipo = classificar(regras, nome, ufOk);
  const label = rotuloCidade({ cidade: nome, uf: ufOk });
  if (tipo === "atendida") return { status: "atendida", cidade: label, regiao: null, naoAtendidaListada: false, fonte: "texto", msgId: null };
  return { status: "fora", cidade: label, regiao: null, naoAtendidaListada: tipo === "nao_atendida", fonte: "texto", msgId: null };
}

/* ------------------------------------ exceções de local ------------------------------------ */

/** Exceção de local (ex.: obra grande) citada pelo cliente ou entendida pelo modelo. */
export function detectarExcecaoLocal(regras: RegrasNegocio, historico: WaMessageLite[], sinais: SinaisModelo = SINAIS_VAZIOS): string | null {
  const tudo = textosDoCliente(historico).join(" \n ");
  for (const e of regras.excecoesLocal) {
    if (e.palavras.some((p) => contemTermo(tudo, p))) return e.descricao;
  }
  const doModelo = sinais.excecao.trim();
  if (doModelo) {
    const n = normalizarTexto(doModelo);
    const certa = regras.excecoesLocal.find((e) => normalizarTexto(e.descricao) === n || n.includes(normalizarTexto(e.descricao)));
    return certa?.descricao ?? doModelo.slice(0, 160);
  }
  return null;
}

/* ------------------------------------ serviço ------------------------------------ */

export function detectarServico(regras: RegrasNegocio, historico: WaMessageLite[], sinais: SinaisModelo = SINAIS_VAZIOS): ServicoDetectado {
  const tudo = textosDoCliente(historico).join(" \n ");
  for (const e of regras.excecoesServico) {
    const p = e.palavras.find((x) => contemTermo(tudo, x));
    if (p) return { status: "excecao", termo: p, descricao: e.descricao };
  }
  for (const r of regras.servicosRecusados) {
    const p = r.palavras.find((x) => contemTermo(tudo, x));
    if (p) return { status: "recusado", termo: p, descricao: r.descricao };
  }
  if (sinais.servico === "recusado") return { status: "recusado", termo: null, descricao: regras.servicosRecusados[0]?.descricao ?? null };
  if (sinais.servico === "excecao" || sinais.servico === "aceito") return { status: sinais.servico, termo: null, descricao: null };
  return { status: "desconhecido", termo: null, descricao: null };
}

/* ------------------------------------ informações mínimas ------------------------------------ */

const IMOVEL = ["casa", "apartamento", "apto", "ap", "sobrado", "comercial", "comercio", "loja", "sala", "galpao", "terreno", "predio", "escritorio", "chacara", "condominio", "kitnet", "cobertura"];
const NOME_DITO = /\b(meu nome e|me chamo|aqui e o|aqui e a|aqui quem fala e|sou o|sou a|eu sou o|eu sou a)\s+[a-z]{3,}/;
const SIM_NAO = /^(sim|nao|ja|ainda nao|tenho|nao tenho|tem|nao tem|possuo|nao possuo)$/;

export interface ContextoInfo {
  local: LocalDetectado;
  servico: ServicoDetectado;
  nomesDoContato: string[];
}

function valorConfere(valor: string, textoCliente: string): boolean {
  const v = normalizarTexto(valor);
  if (!v || SIM_NAO.test(v)) return false;
  const tokens = v.split(" ").filter((p) => p.length >= 4);
  if (!tokens.length) return contemTermo(textoCliente, v);
  const achou = tokens.filter((p) => textoCliente.includes(p.slice(0, 5))).length;
  return achou / tokens.length >= 0.5;
}

/** O agente perguntou sobre isso (mensagem do negócio com a palavra) e o cliente respondeu depois. */
function perguntouERespondeu(historico: WaMessageLite[], palavras: string[]): boolean {
  let perguntou = false;
  for (const m of historico) {
    const t = normalizarTexto(m.body ?? "");
    if (m.fromMe && palavras.some((p) => contemTermo(t, p))) perguntou = true;
    else if (!m.fromMe && perguntou && normalizarTexto(textoPlano(m))) return true;
  }
  return false;
}

function coletadoPara(info: InfoMinima, coletado: Record<string, string>): string {
  const c = normalizarTexto(info.campo);
  for (const [k, v] of Object.entries(coletado)) {
    const nk = normalizarTexto(k);
    if (nk && (nk === c || c.includes(nk) || nk.includes(c))) return String(v ?? "");
  }
  return "";
}

export function infoPresente(info: InfoMinima, historico: WaMessageLite[], ctx: ContextoInfo, sinais: SinaisModelo = SINAIS_VAZIOS): boolean {
  const campo = normalizarTexto(info.campo);
  const cliente = textosDoCliente(historico).join(" \n ");
  if (valorConfere(coletadoPara(info, sinais.coletado), cliente)) return true;

  if (/\bnome\b/.test(campo)) {
    if (ctx.nomesDoContato.some((n) => normalizarTexto(n).replace(/\s/g, "").length >= 2)) return true;
    return NOME_DITO.test(cliente);
  }
  if (/\b(local|cidade|onde|endereco|regiao|bairro)\b/.test(campo)) return ctx.local.status !== "desconhecida";
  if (/\b(necessidade|servico|precisa|pedido|o que)\b/.test(campo) && ctx.servico.status !== "desconhecido") return true;

  const palavras = info.palavras.length
    ? info.palavras
    : /\bimovel\b/.test(campo)
      ? IMOVEL
      : campo.split(" ").filter((p) => p.length >= 5);
  const lista = /\bimovel\b/.test(campo) ? [...new Set([...palavras, ...IMOVEL])] : palavras;
  if (lista.some((p) => contemTermo(cliente, p))) return true;
  return perguntouERespondeu(historico, lista);
}

export function infosFaltando(regras: RegrasNegocio, historico: WaMessageLite[], ctx: ContextoInfo, sinais: SinaisModelo = SINAIS_VAZIOS): InfoMinima[] {
  return regras.infoMinima.filter((i) => !infoPresente(i, historico, ctx, sinais));
}
