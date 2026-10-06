/**
 * Do JSON da IA ao rascunho da tela Agentes, sem IA (dá pra testar tudo).
 *
 * - Mensagens aprovadas e exemplos de fala entram LITERAIS: quem junta é o
 *   código, não a IA. Se a mensagem não aparece igual no documento, a tela avisa.
 * - "A definir" é achado também por regra simples no texto, além do que a IA
 *   listou: nenhuma pendência some porque a IA esqueceu.
 * - Telefone, preço, prazo, porcentagem, link e horário que aparecem num campo
 *   e não no documento vão pro "Confira antes de salvar".
 * - Nada aqui liga agente nem muda o modo do número: o rascunho não tem esses campos.
 */
import { extrairAfirmacoes } from "@/lib/whatsapp/agentes/guardas";
import {
  AGENTES_TREINO,
  LIMITE_COMANDO_BASE,
  LIMITE_FATO,
  LIMITE_FATOS,
  LIMITE_INSTRUCOES,
  type AgenteTreino,
  type CampoTreino,
  type RascunhoTreino,
  type RespostaIa,
  type TipoMensagem,
} from "./esquema";

/** Pra comparar textos: minúsculo, aspas e espaços iguais. */
export function normalizar(s: string): string {
  return s
    .normalize("NFC")
    .toLowerCase()
    .replace(/[“”«»„]/g, '"')
    .replace(/[‘’`´]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function semAspasDasPontas(s: string): string {
  return s.trim().replace(/^["“'‘]+|["”'’]+$/g, "").trim();
}

/** A mensagem aparece igual (ignorando maiúscula, aspas e espaços) no documento? */
export function apareceNoDocumento(trecho: string, documento: string): boolean {
  const t = normalizar(semAspasDasPontas(trecho));
  return t.length > 0 && normalizar(documento).includes(t);
}

const A_DEFINIR = /\ba\s+definir\b/i;
/** "escreva “A definir”" é instrução de preenchimento, não pendência. */
const A_DEFINIR_ENTRE_ASPAS = /["“'‘]\s*a\s+definir\s*["”'’]/i;
const RESPOSTA = /^\s*resposta\s*:\s*/i;

/** Pendências por regra: cada linha com "A definir" (fora de aspas) e a pergunta logo acima. */
export function pendenciasDoTexto(documento: string): Array<{ assunto: string; trecho: string }> {
  const linhas = documento.split("\n").map((l) => l.trim());
  const out: Array<{ assunto: string; trecho: string }> = [];
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (!A_DEFINIR.test(linha) || A_DEFINIR_ENTRE_ASPAS.test(linha)) continue;
    let assunto = "";
    let trecho = linha;
    if (RESPOSTA.test(linha)) {
      trecho = linha.replace(RESPOSTA, "");
      for (let j = i - 1; j >= 0; j--) {
        if (linhas[j] && !RESPOSTA.test(linhas[j])) {
          assunto = linhas[j];
          break;
        }
      }
    } else {
      const dois = linha.indexOf(":");
      if (dois > 0 && dois < linha.length - 1) {
        assunto = linha.slice(0, dois);
        trecho = linha.slice(dois + 1).trim();
      }
    }
    out.push({ assunto: (assunto || trecho).slice(0, 300), trecho: trecho.slice(0, 300) });
  }
  return out;
}

function juntarPendencias(daIa: RespostaIa["pendencias"], doTexto: Array<{ assunto: string; trecho: string }>) {
  const out = daIa.map((p) => ({ assunto: p.assunto.trim().slice(0, 300), trecho: p.trecho.trim().slice(0, 300) }));
  for (const p of doTexto) {
    const chaveTrecho = normalizar(p.trecho).slice(0, 40);
    const chaveAssunto = normalizar(p.assunto).slice(0, 40);
    const coberta = out.some((q) => {
      const tudo = normalizar(`${q.assunto} ${q.trecho}`);
      return (chaveAssunto.length > 0 && tudo.includes(chaveAssunto)) || (chaveTrecho.length > 15 && tudo.includes(chaveTrecho));
    });
    if (!coberta) out.push(p);
  }
  return out;
}

const QUANDO_PADRAO: Record<TipoMensagem, string> = {
  boas_vindas: "Primeira resposta a uma pessoa nova",
  encaminhamento: "Quando passar a conversa pra pessoa responsável",
  fora_do_horario: "Quando a mensagem chegar fora do horário de atendimento",
  encerramento: "Quando a pessoa disser que não quer continuar ou pedir pra parar",
  outra: "Quando o documento indicar",
};

function aspas(t: string) {
  return `"${semAspasDasPontas(t)}"`;
}

function cortar(texto: string, limite: number): { texto: string; cortado: boolean } {
  return texto.length > limite ? { texto: texto.slice(0, limite).trimEnd(), cortado: true } : { texto, cortado: false };
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
function horaValida(s: string): string | null {
  const m = HHMM.exec(s.trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
}

/* ----------------------- números que não estão no documento ----------------------- */

const RE_TELEFONE = /(?:\+?55\s?)?\(?\b\d{2}\)?\s?9?\d{4}[-.\s]?\d{4}\b/g;
const RE_HORA = /\b([01]?\d|2[0-3])\s?(?:h|:)\s?([0-5]\d)?(?![\w])/gi;

function telefones(t: string): string[] {
  return (t.match(RE_TELEFONE) ?? []).map((m) => m.replace(/\D/g, "").slice(-8));
}
function horas(t: string): string[] {
  const out: string[] = [];
  for (const m of t.matchAll(RE_HORA)) out.push(`${Number(m[1])}:${m[2] ?? "00"}`);
  return out;
}

/** O que um campo cita (telefone, preço, prazo, porcentagem, link, horário) e o documento não. */
export function valoresForaDoDocumento(campo: string, texto: string, documento: string): Array<{ campo: string; valor: string }> {
  const out: Array<{ campo: string; valor: string }> = [];
  const visto = new Set<string>();
  const add = (valor: string) => {
    const k = valor.toLowerCase();
    if (visto.has(k)) return;
    visto.add(k);
    out.push({ campo, valor });
  };

  const telsDoc = new Set(telefones(documento));
  for (const m of texto.match(RE_TELEFONE) ?? []) if (!telsDoc.has(m.replace(/\D/g, "").slice(-8))) add(m.trim());

  const doc = extrairAfirmacoes(documento);
  const chaves = new Set(doc.map((a) => `${a.tipo}:${a.chave}`));
  const semTelefones = texto.replace(RE_TELEFONE, " ");
  for (const a of extrairAfirmacoes(semTelefones)) {
    if (!chaves.has(`${a.tipo}:${a.chave}`)) add(a.texto.replace(/[.,;:]+$/, ""));
  }

  const horasDoc = new Set(horas(documento.replace(RE_TELEFONE, " ")));
  for (const m of semTelefones.matchAll(RE_HORA)) {
    if (!horasDoc.has(`${Number(m[1])}:${m[2] ?? "00"}`)) add(m[0].trim());
  }
  return out;
}

/* ----------------------------------- montar ----------------------------------- */

export interface ArquivoTreino {
  nome: string;
  tipo: "pdf" | "docx";
  /** Texto que a IA leu (já cortado no limite). */
  texto: string;
  /** O documento tinha mais texto que o limite. */
  cortado: boolean;
}

export function montarRascunho(resp: RespostaIa, arquivo: ArquivoTreino): RascunhoTreino {
  const documento = arquivo.texto;
  const avisos: RascunhoTreino["revisar"]["avisos"] = [];
  if (arquivo.cortado) avisos.push({ texto: "The document was too long. Only the first part was read. Check if something is missing at the end." });

  // Mensagens aprovadas e exemplos de fala, literais.
  const mensagens = resp.mensagens_aprovadas.map((m) => ({
    tipo: m.tipo,
    quando: m.quando.trim() || QUANDO_PADRAO[m.tipo],
    texto: semAspasDasPontas(m.texto),
    literal: apareceNoDocumento(m.texto, documento),
  }));
  const exemplos = resp.exemplos_de_fala.map((e) => semAspasDasPontas(e)).filter(Boolean);
  const exemplosFora = exemplos.filter((e) => !apareceNoDocumento(e, documento));

  const boasVindas = mensagens.filter((m) => m.tipo === "boas_vindas");
  const outras = mensagens.filter((m) => m.tipo !== "boas_vindas");

  const partesBase = [resp.comando_base.trim()];
  if (outras.length) {
    partesBase.push(
      "MENSAGENS APROVADAS PELA EMPRESA (use o texto exato, sem mudar nada):\n" + outras.map((m) => `${m.quando}: ${aspas(m.texto)}`).join("\n")
    );
  }
  if (exemplos.length) {
    partesBase.push(
      "EXEMPLOS DE COMO A EMPRESA FALA (só referência de tom; não copie fatos nem números deles):\n" + exemplos.map((e) => aspas(e)).join("\n")
    );
  }
  const base = cortar(partesBase.join("\n\n"), LIMITE_COMANDO_BASE);
  if (base.cortado) avisos.push({ texto: "The base Comando passed 8000 characters and the end was cut. Check it." });

  const agents = {} as Record<AgenteTreino, string>;
  for (const agente of AGENTES_TREINO) {
    let texto = resp.instrucoes[agente].trim();
    if (agente === "qualificacao" && boasVindas.length) {
      const bloco = `MENSAGEM DE BOAS-VINDAS (primeira resposta a uma pessoa nova, use o texto exato):\n${boasVindas.map((m) => aspas(m.texto)).join("\n")}`;
      texto = texto ? `${bloco}\n\n${texto}` : bloco;
    }
    const c = cortar(texto, LIMITE_INSTRUCOES);
    if (c.cortado) avisos.push({ texto: "The instructions of the {agent} agent passed 4000 characters and the end was cut. Check them.", agente });
    agents[agente] = c.texto;
  }

  const fatosLimpos = [...new Set(resp.fatos.map((f) => f.replace(/\s+/g, " ").trim()).filter(Boolean))];
  if (fatosLimpos.length > LIMITE_FATOS) avisos.push({ texto: "The document had more than 30 facts. Only the first 30 came in." });
  const facts = fatosLimpos.slice(0, LIMITE_FATOS).map((f) => f.slice(0, LIMITE_FATO));

  let quietStart: string | null = null;
  let quietEnd: string | null = null;
  if (resp.horario_silencio) {
    quietStart = horaValida(resp.horario_silencio.inicio);
    quietEnd = horaValida(resp.horario_silencio.fim);
    if (!quietStart || !quietEnd) {
      quietStart = quietEnd = null;
      avisos.push({ texto: "The quiet hours in the document could not be read. Fill them in by hand if you want them." });
    }
  }
  const atraso = resp.atraso_segundos ? { de: Math.min(resp.atraso_segundos.de, resp.atraso_segundos.ate), ate: Math.max(resp.atraso_segundos.de, resp.atraso_segundos.ate) } : null;

  const doDocumento: CampoTreino[] = ["baseCommand"];
  if (facts.length) doDocumento.push("facts");
  if (quietStart) doDocumento.push("quietHours");
  if (atraso) doDocumento.push("delay");
  if (resp.limite_diario !== null) doDocumento.push("maxAutoPerDay");
  for (const agente of AGENTES_TREINO) if (agents[agente]) doDocumento.push(`agent:${agente}`);

  // Conferências.
  const naoAchei = [
    ...valoresForaDoDocumento("baseCommand", base.texto, documento),
    ...valoresForaDoDocumento("facts", facts.join("\n"), documento),
    ...AGENTES_TREINO.flatMap((a) => valoresForaDoDocumento(`agent:${a}`, agents[a], documento)),
  ];
  for (const m of mensagens) if (!m.literal) naoAchei.push({ campo: "message", valor: m.texto.slice(0, 160) });
  for (const e of exemplosFora) naoAchei.push({ campo: "example", valor: e.slice(0, 160) });

  const camposComADefinir = [
    ["baseCommand", base.texto] as const,
    ["facts", facts.join("\n")] as const,
    ...AGENTES_TREINO.map((a) => [`agent:${a}`, agents[a]] as const),
  ].filter(([, t]) => A_DEFINIR.test(t));
  if (camposComADefinir.length) avisos.push({ texto: "A field mentions something the document marks as A definir. Check that it did not become a rule." });

  return {
    arquivo: { nome: arquivo.nome, tipo: arquivo.tipo, caracteres: documento.length, cortado: arquivo.cortado },
    profile: {
      baseCommand: base.texto,
      facts,
      quietStart,
      quietEnd,
      delayMinSeconds: atraso?.de ?? null,
      delayMaxSeconds: atraso?.ate ?? null,
      maxAutoPerDay: resp.limite_diario,
    },
    agents,
    doDocumento,
    mensagensAprovadas: mensagens,
    casosDeTeste: resp.casos_de_teste.map((c) => ({ situacao: c.situacao.trim(), decisao: c.decisao.trim(), motivo: c.motivo.trim() })),
    revisar: {
      pendencias: juntarPendencias(resp.pendencias, pendenciasDoTexto(documento)),
      soInstrucao: resp.regras_so_instrucao.map((r) => ({ regra: r.regra.trim(), onde: r.onde })),
      contradicoes: resp.contradicoes.map((c) => ({ descricao: c.descricao.trim() })),
      naoAchei,
      avisos,
    },
  };
}
