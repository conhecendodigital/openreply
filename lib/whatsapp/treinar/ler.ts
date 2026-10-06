/**
 * Texto do documento enviado no "Treinar com um documento": PDF (unpdf, o
 * mesmo do cérebro) ou Word .docx (zip lido na mão, lib/whatsapp/cerebro/docx.ts).
 * Tipo pelos bytes. Nada aqui grava ou loga o texto.
 */
import { DocxError, extractDocxText, isCfbBytes, isZipBytes } from "@/lib/whatsapp/cerebro/docx";
import { MAX_PDF_PAGES } from "@/lib/whatsapp/cerebro/limits";
import { extractPdfText, isPdfBytes, PdfError } from "@/lib/whatsapp/cerebro/pdf";
import { MAX_CARACTERES_DOCUMENTO } from "./comando";

export type ErroLeitura =
  | "not_supported"
  | "pdf_encrypted"
  | "pdf_invalid"
  | "pdf_no_text"
  | "too_many_pages"
  | "docx_encrypted"
  | "docx_invalid"
  | "docx_no_text"
  | "docx_too_large";

export type Leitura = { ok: true; tipo: "pdf" | "docx"; texto: string; cortado: boolean } | { ok: false; erro: ErroLeitura };

export async function lerDocumento(bytes: Uint8Array, maxChars = MAX_CARACTERES_DOCUMENTO): Promise<Leitura> {
  if (isPdfBytes(bytes)) {
    try {
      // Um pouco a mais que o limite, pra saber se cortou.
      const pdf = await extractPdfText(bytes, { maxPages: MAX_PDF_PAGES, maxChars: maxChars + 1 });
      const texto = pdf.pages.join("\n\n");
      return { ok: true, tipo: "pdf", texto: texto.slice(0, maxChars), cortado: pdf.truncated || texto.length > maxChars };
    } catch (error) {
      const code = error instanceof PdfError ? error.code : "pdf_invalid";
      return { ok: false, erro: code === "not_pdf" ? "not_supported" : code };
    }
  }
  if (isZipBytes(bytes) || isCfbBytes(bytes)) {
    try {
      const { text, truncated } = extractDocxText(bytes, { maxChars });
      return { ok: true, tipo: "docx", texto: text, cortado: truncated };
    } catch (error) {
      const code = error instanceof DocxError ? error.code : "docx_invalid";
      return { ok: false, erro: code === "not_docx" ? "not_supported" : code };
    }
  }
  return { ok: false, erro: "not_supported" };
}
