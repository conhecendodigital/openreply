/**
 * Texto de PDF com o `unpdf` (MIT, zero dependências, ~2 MB): é o PDF.js da
 * Mozilla empacotado pra servidor. Escolhido porque:
 * - PDF.js é o leitor de PDF mais testado que existe (é o do Firefox);
 * - não traz binário nativo (o `pdf-parse` v2 puxa `@napi-rs/canvas`) e não
 *   precisa de worker separado nem de `canvas` pra extrair texto;
 * - o `pdfjs-dist` puro tem 35 MB e exige montar o worker no Node na mão.
 *
 * O PDF.js empacotado (6.x) não usa eval nem new Function, e rodamos sem
 * carregar fontes do sistema. O tipo do arquivo é conferido pelos bytes
 * (`%PDF-`), nunca pelo nome ou pelo Content-Type que o navegador mandou.
 */
import { MAX_PDF_PAGES, MAX_PDF_TEXT_CHARS } from "@/lib/whatsapp/cerebro/limits";

export type PdfErrorCode =
  | "not_pdf"
  | "pdf_encrypted"
  | "pdf_invalid"
  | "too_many_pages"
  | "pdf_no_text";

export class PdfError extends Error {
  constructor(public readonly code: PdfErrorCode, message?: string) {
    super(message ?? code);
    this.name = "PdfError";
  }
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
/** A especificação deixa o cabeçalho aparecer nos primeiros 1024 bytes. */
const MAGIC_WINDOW = 1024;

/** True quando os bytes começam (nos primeiros 1 KB) com o cabeçalho de PDF. */
export function isPdfBytes(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.length - PDF_MAGIC.length, MAGIC_WINDOW);
  for (let i = 0; i <= end; i++) {
    let match = true;
    for (let j = 0; j < PDF_MAGIC.length; j++) {
      if (bytes[i + j] !== PDF_MAGIC[j]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }
  return false;
}

export interface PdfText {
  pageCount: number;
  /** Texto de cada página, na ordem (índice 0 = página 1). */
  pages: string[];
  /** True quando o texto passou de MAX_PDF_TEXT_CHARS e foi cortado. */
  truncated: boolean;
}

/** Limpa o texto de uma página: junta palavra quebrada com hífen, tira lixo. */
export function cleanPageText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f­�]/g, "")
    .replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type PdfProxy = {
  numPages: number;
  destroy?: () => Promise<void>;
  loadingTask?: { destroy(): Promise<void> };
};

/** Libera a memória do PDF.js (o nome do método mudou entre versões). */
async function closePdf(pdf: PdfProxy): Promise<void> {
  try {
    if (pdf.loadingTask) await pdf.loadingTask.destroy();
    else if (pdf.destroy) await pdf.destroy();
  } catch {
    // nada a fazer
  }
}

async function openPdf(bytes: Uint8Array): Promise<PdfProxy> {
  if (!isPdfBytes(bytes)) throw new PdfError("not_pdf");
  const { getDocumentProxy } = await import("unpdf");
  try {
    // O PDF.js pode "transferir" o buffer; mandamos uma cópia.
    return (await getDocumentProxy(new Uint8Array(bytes), {
      useSystemFonts: false,
      disableFontFace: true,
      stopAtErrors: false,
      verbosity: 0, // só erros: fonte padrão ausente não interessa pra extrair texto
    })) as unknown as PdfProxy;
  } catch (error) {
    const name = (error as { name?: string } | null)?.name;
    if (name === "PasswordException") throw new PdfError("pdf_encrypted");
    throw new PdfError("pdf_invalid");
  }
}

/** Só conta as páginas (rápido: não lê o texto). Usado na rota de envio. */
export async function countPdfPages(bytes: Uint8Array): Promise<number> {
  const pdf = await openPdf(bytes);
  try {
    return pdf.numPages;
  } finally {
    await closePdf(pdf);
  }
}

/** Extrai o texto página por página, com limite de páginas e de tamanho. */
export async function extractPdfText(
  bytes: Uint8Array,
  options: { maxPages?: number; maxChars?: number } = {}
): Promise<PdfText> {
  const maxPages = options.maxPages ?? MAX_PDF_PAGES;
  const maxChars = options.maxChars ?? MAX_PDF_TEXT_CHARS;
  const pdf = await openPdf(bytes);
  try {
    if (pdf.numPages > maxPages) throw new PdfError("too_many_pages");
    const { extractText } = await import("unpdf");
    let result: { text: string[] };
    try {
      result = await extractText(pdf as never, { mergePages: false });
    } catch {
      throw new PdfError("pdf_invalid");
    }
    const pages: string[] = [];
    let total = 0;
    let truncated = false;
    for (const raw of result.text) {
      let text = cleanPageText(raw ?? "");
      if (total + text.length > maxChars) {
        text = text.slice(0, Math.max(0, maxChars - total));
        truncated = true;
      }
      total += text.length;
      pages.push(text);
      if (truncated) break;
    }
    if (pages.every((p) => p.trim().length === 0)) throw new PdfError("pdf_no_text");
    return { pageCount: pdf.numPages, pages, truncated };
  } finally {
    await closePdf(pdf);
  }
}
