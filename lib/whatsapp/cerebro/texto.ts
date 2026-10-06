/**
 * Documento do cérebro que não é PDF (hoje: o .docx do "Treinar com um
 * documento"). Guardamos só o TEXTO extraído na mesma coluna "data" do
 * WaKnowledgeDocument, com um cabeçalho que nenhum PDF tem. Assim a fila
 * wa-cerebro processa os dois pelo mesmo caminho, sem migração nova.
 */
import { MAX_PDF_PAGES, MAX_PDF_TEXT_CHARS } from "@/lib/whatsapp/cerebro/limits";
import { cleanPageText, extractPdfText, PdfError, type PdfText } from "@/lib/whatsapp/cerebro/pdf";

export const STORED_TEXT_MAGIC = "LE-TEXTO-1\n";
const MAGIC_BYTES = Buffer.from(STORED_TEXT_MAGIC, "utf8");

export function encodeStoredText(text: string): Uint8Array {
  return new Uint8Array(Buffer.concat([MAGIC_BYTES, Buffer.from(text, "utf8")]));
}

export function isStoredText(bytes: Uint8Array): boolean {
  if (bytes.length < MAGIC_BYTES.length) return false;
  for (let i = 0; i < MAGIC_BYTES.length; i++) if (bytes[i] !== MAGIC_BYTES[i]) return false;
  return true;
}

export function decodeStoredText(bytes: Uint8Array): string {
  return Buffer.from(bytes.subarray(MAGIC_BYTES.length)).toString("utf8");
}

/** Texto do documento guardado: PDF pelo unpdf, texto guardado direto (1 "página"). */
export async function extractStoredDocument(bytes: Uint8Array, options: { maxPages?: number; maxChars?: number } = {}): Promise<PdfText> {
  if (!isStoredText(bytes)) return extractPdfText(bytes, { maxPages: options.maxPages ?? MAX_PDF_PAGES, maxChars: options.maxChars });
  const max = options.maxChars ?? MAX_PDF_TEXT_CHARS;
  const full = cleanPageText(decodeStoredText(bytes));
  if (!full.trim()) throw new PdfError("pdf_no_text");
  const truncated = full.length > max;
  return { pageCount: 1, pages: [truncated ? full.slice(0, max) : full], truncated };
}
