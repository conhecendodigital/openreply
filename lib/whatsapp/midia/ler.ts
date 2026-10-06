/**
 * Lê a mídia que o cliente mandou (áudio, foto, PDF) antes do agente rodar e
 * devolve um texto derivado pra guardar na mensagem (WaMessage.mediaText).
 *
 *   áudio  -> transcrição (OpenAI, chave do /admin)
 *   foto   -> descrição curta (visão, mesmo provedor do agente; cai no outro se faltar chave)
 *   PDF    -> trecho do texto (unpdf, sem IA)
 *   vídeo, figurinha, outro arquivo -> não lê (o agente vê [video] etc.)
 *
 * Nada aqui trava o agente: falhou baixar, falhou a IA, passou do limite, sem
 * chave ou teto do dia estourado, a mensagem fica com mediaText vazio e o
 * motivo em mediaTextStatus, e o agente segue com "[tipo]".
 *
 * Privacidade: o texto da mídia nunca vai pro log nem pra mensagem de erro.
 */
import { custoUsdMicro, type Preco } from "@/lib/whatsapp/agentes/modelos";
import type { IaProvider } from "@/lib/whatsapp/agentes/types";
import { extractPdfText, isPdfBytes, PdfError } from "@/lib/whatsapp/cerebro/pdf";
import { duracaoOggSegundos, formatoImagem } from "./formatos";
import {
  AUDIO_MAX_BYTES,
  AUDIO_MAX_SEGUNDOS,
  DESCRICAO_MAX_CARACTERES,
  IMAGEM_MAX_BYTES,
  MODELO_TRANSCRICAO,
  MODELO_VISAO_ANTHROPIC,
  MODELO_VISAO_OPENAI,
  MODELO_WHISPER,
  PDF_MAX_BYTES,
  PDF_MAX_CARACTERES,
  PDF_MAX_PAGINAS,
  PRECOS_MIDIA,
  TOKENS_AUDIO_POR_SEGUNDO,
  TOKENS_TEXTO_POR_SEGUNDO,
  TRANSCRICAO_MAX_CARACTERES,
  VISAO_MAX_TOKENS_SAIDA,
  VISAO_TOKENS_IMAGEM_MAX,
} from "./limites";
import { descreverFoto, transcreverOpenAI, type Descritor, type Transcritor, type UsoMidia } from "./provedores";

export type TipoLeitura = "audio" | "image" | "pdf";
export type StatusLeitura = "ok" | "too_large" | "no_key" | "cap" | "failed" | "no_text" | "unsupported";

export interface MidiaPendente {
  id: string;
  type: string;
  mime: string | null;
  filename: string | null;
  /** Legenda (body da mensagem de mídia). */
  legenda: string | null;
}

export interface Leitura {
  messageId: string;
  kind: TipoLeitura;
  status: StatusLeitura;
  texto: string | null;
}

export interface DepsLeitura {
  baixar(messageId: string): Promise<{ bytes: Uint8Array; contentType: string | null } | null>;
  salvar(leitura: Leitura): Promise<void>;
  /** Chave aberta do /admin, ou null. */
  chave(provider: IaProvider): Promise<string | null>;
  /** Provedor do agente ligado no número (a foto usa o mesmo). */
  provedorVisao: IaProvider;
  /** O gasto do dia + este pior caso cabe no teto? */
  cabeNoTeto(custoPrevistoUsdMicro: number): Promise<boolean>;
  /** Cada chamada paga (ou barrada pelo teto) no relatório de gastos. Erro aqui não derruba nada. */
  registrarUso?(u: { messageId: string; provider: IaProvider; modelo: string; uso: UsoMidia; bloqueado: boolean }): Promise<void>;
  /** Tabela de preços do /admin (formato do motor). PRECOS_MIDIA entra por baixo. */
  precos?: Record<string, Preco>;
  transcrever?: Transcritor;
  descrever?: Descritor;
  modeloTranscricao?: string;
}

/** O que dá pra ler dessa mensagem, ou null (vídeo, figurinha, arquivo que não é PDF). */
export function tipoDeLeitura(m: { type: string; mime: string | null; filename: string | null }): TipoLeitura | null {
  if (m.type === "audio") return "audio";
  if (m.type === "image") return "image";
  if (m.type === "document") {
    const mime = (m.mime ?? "").toLowerCase();
    const nome = (m.filename ?? "").toLowerCase();
    // Sem mime nem nome, baixa e confere pelos bytes.
    if (mime.includes("pdf") || nome.endsWith(".pdf") || (!mime && !nome)) return "pdf";
  }
  return null;
}

function tabela(deps: DepsLeitura): Record<string, Preco> {
  return { ...PRECOS_MIDIA, ...(deps.precos ?? {}) };
}

async function usar(deps: DepsLeitura, u: Parameters<NonNullable<DepsLeitura["registrarUso"]>>[0]) {
  try {
    await deps.registrarUso?.(u);
  } catch {
    // O relatório não pode derrubar a leitura.
  }
}

/** Pior caso da transcrição (o fallback whisper-1 é o mais caro por segundo). */
export function custoMaximoAudio(segundos: number, precos: Record<string, Preco>, modelo = MODELO_TRANSCRICAO): number {
  const s = Math.max(1, Math.ceil(segundos));
  const principal = custoUsdMicro(modelo, { tokensIn: s * TOKENS_AUDIO_POR_SEGUNDO, tokensOut: s * TOKENS_TEXTO_POR_SEGUNDO, cacheRead: 0, cacheWrite: 0 }, precos);
  const whisper = custoUsdMicro(MODELO_WHISPER, { tokensIn: s, tokensOut: 0, cacheRead: 0, cacheWrite: 0 }, precos);
  return Math.max(principal, whisper);
}

/** Pior caso da descrição da foto. */
export function custoMaximoFoto(modelo: string, precos: Record<string, Preco>): number {
  return custoUsdMicro(modelo, { tokensIn: VISAO_TOKENS_IMAGEM_MAX + 400, tokensOut: VISAO_MAX_TOKENS_SAIDA, cacheRead: 0, cacheWrite: 0 }, precos);
}

async function lerAudio(m: MidiaPendente, deps: DepsLeitura): Promise<Omit<Leitura, "messageId" | "kind">> {
  const apiKey = await deps.chave("openai");
  if (!apiKey) return { status: "no_key", texto: null };
  const arquivo = await deps.baixar(m.id);
  if (!arquivo) return { status: "failed", texto: null };
  if (arquivo.bytes.byteLength > AUDIO_MAX_BYTES) return { status: "too_large", texto: null };
  const duracao = duracaoOggSegundos(arquivo.bytes);
  if (duracao !== null && duracao > AUDIO_MAX_SEGUNDOS) return { status: "too_large", texto: null };
  // Sem duração (não é Ogg): estima pelo tamanho (voz comprimida ~ 2 KB/s), no máximo o limite.
  const segundos = Math.min(AUDIO_MAX_SEGUNDOS, duracao ?? Math.max(1, arquivo.bytes.byteLength / 2000));
  const precos = tabela(deps);
  const modelo = deps.modeloTranscricao ?? MODELO_TRANSCRICAO;
  if (!(await deps.cabeNoTeto(custoMaximoAudio(segundos, precos, modelo)))) {
    await usar(deps, { messageId: m.id, provider: "openai", modelo, uso: { tokensIn: 0, tokensOut: 0 }, bloqueado: true });
    return { status: "cap", texto: null };
  }
  const r = await (deps.transcrever ?? transcreverOpenAI)({ apiKey, modelo, bytes: arquivo.bytes, mime: arquivo.contentType ?? m.mime, segundos });
  await usar(deps, { messageId: m.id, provider: "openai", modelo: r.modelo, uso: r.uso, bloqueado: false });
  const texto = r.texto.trim().slice(0, TRANSCRICAO_MAX_CARACTERES);
  return texto ? { status: "ok", texto } : { status: "no_text", texto: null };
}

async function lerFoto(m: MidiaPendente, deps: DepsLeitura): Promise<Omit<Leitura, "messageId" | "kind">> {
  const outro: IaProvider = deps.provedorVisao === "anthropic" ? "openai" : "anthropic";
  let provider = deps.provedorVisao;
  let apiKey = await deps.chave(provider);
  if (!apiKey) {
    provider = outro;
    apiKey = await deps.chave(outro);
  }
  if (!apiKey) return { status: "no_key", texto: null };
  const arquivo = await deps.baixar(m.id);
  if (!arquivo) return { status: "failed", texto: null };
  if (arquivo.bytes.byteLength > IMAGEM_MAX_BYTES) return { status: "too_large", texto: null };
  const formato = formatoImagem(arquivo.bytes);
  if (!formato) return { status: "unsupported", texto: null };
  const modelo = provider === "anthropic" ? MODELO_VISAO_ANTHROPIC : MODELO_VISAO_OPENAI;
  if (!(await deps.cabeNoTeto(custoMaximoFoto(modelo, tabela(deps))))) {
    await usar(deps, { messageId: m.id, provider, modelo, uso: { tokensIn: 0, tokensOut: 0 }, bloqueado: true });
    return { status: "cap", texto: null };
  }
  const r = await (deps.descrever ?? descreverFoto)({ provider, modelo, apiKey, bytes: arquivo.bytes, formato, legenda: m.legenda });
  await usar(deps, { messageId: m.id, provider, modelo: r.modelo, uso: r.uso, bloqueado: false });
  const texto = r.texto.trim().slice(0, DESCRICAO_MAX_CARACTERES);
  return texto ? { status: "ok", texto } : { status: "no_text", texto: null };
}

async function lerPdf(m: MidiaPendente, deps: DepsLeitura): Promise<Omit<Leitura, "messageId" | "kind">> {
  const arquivo = await deps.baixar(m.id);
  if (!arquivo) return { status: "failed", texto: null };
  if (arquivo.bytes.byteLength > PDF_MAX_BYTES) return { status: "too_large", texto: null };
  if (!isPdfBytes(arquivo.bytes)) return { status: "unsupported", texto: null };
  try {
    const pdf = await extractPdfText(arquivo.bytes, { maxPages: PDF_MAX_PAGINAS, maxChars: PDF_MAX_CARACTERES, firstPagesOnly: true });
    const corpo = pdf.pages
      .map((p) => p.trim())
      .filter(Boolean)
      .join("\n\n");
    if (!corpo) return { status: "no_text", texto: null };
    const aviso = pdf.truncated ? `\n\n(PDF com ${pdf.pageCount} páginas: só o começo foi lido.)` : "";
    return { status: "ok", texto: corpo + aviso };
  } catch (e) {
    if (e instanceof PdfError && e.code === "pdf_no_text") return { status: "no_text", texto: null };
    if (e instanceof PdfError && (e.code === "pdf_encrypted" || e.code === "not_pdf")) return { status: "unsupported", texto: null };
    return { status: "failed", texto: null };
  }
}

/**
 * Lê cada mídia pendente (uma por vez) e salva o resultado. Devolve só tipo e
 * status (sem o texto), pro log do worker.
 */
export async function lerMidias(pendentes: MidiaPendente[], deps: DepsLeitura): Promise<Array<Pick<Leitura, "messageId" | "kind" | "status">>> {
  const out: Array<Pick<Leitura, "messageId" | "kind" | "status">> = [];
  for (const m of pendentes) {
    const kind = tipoDeLeitura(m);
    if (!kind) continue;
    let r: Omit<Leitura, "messageId" | "kind">;
    try {
      r = kind === "audio" ? await lerAudio(m, deps) : kind === "image" ? await lerFoto(m, deps) : await lerPdf(m, deps);
    } catch {
      // Baixar ou a IA falhou: segue sem texto.
      r = { status: "failed", texto: null };
    }
    const leitura: Leitura = { messageId: m.id, kind, ...r };
    try {
      await deps.salvar(leitura);
    } catch {
      // Não salvou: o agente segue com "[tipo]".
    }
    out.push({ messageId: m.id, kind, status: r.status });
  }
  return out;
}
