/**
 * Envio de PDF (ou documento do Word, .docx) pra base de conhecimento de um
 * agente (lógica da rota).
 *
 * Só pessoa logada (sessão), nunca chave de API. Confere tamanho antes de ler,
 * tipo pelos bytes (%PDF- ou zip com word/document.xml), páginas e arquivo com
 * senha. Do .docx guardamos só o texto extraído (lib/whatsapp/cerebro/texto.ts),
 * nunca o arquivo original. O texto do PDF e os embeddings são feitos depois,
 * na fila wa-cerebro.
 */
import { createHash } from "node:crypto";
import { MAX_DOCS_PER_AGENT, MAX_PDF_BYTES, MAX_PDF_PAGES, MAX_PDF_TEXT_CHARS, MAX_UPLOAD_BODY_BYTES } from "@/lib/whatsapp/cerebro/limits";
import { DocxError, extractDocxText, isCfbBytes, isZipBytes } from "@/lib/whatsapp/cerebro/docx";
import { countPdfPages, isPdfBytes, PdfError } from "@/lib/whatsapp/cerebro/pdf";
import { encodeStoredText } from "@/lib/whatsapp/cerebro/texto";
import type { CerebroStore } from "@/lib/whatsapp/cerebro/store";
import type { AgentKind, CerebroIngestJob, CerebroScope, KnowledgeDoc } from "@/lib/whatsapp/cerebro/types";

export type UploadOutcome =
  | { ok: true; status: 200 | 202; document: KnowledgeDoc; duplicate: boolean }
  | { ok: false; status: number; code: string; message: string };

export interface UploadDeps {
  store: Pick<CerebroStore, "countDocuments" | "createDocument" | "markError">;
  enqueue: (job: CerebroIngestJob) => Promise<void>;
  countPages?: (bytes: Uint8Array) => Promise<number>;
}

const MESSAGES: Record<string, string> = {
  too_large: `O PDF passa do limite de ${Math.round(MAX_PDF_BYTES / 1024 / 1024)} MB.`,
  no_file: "Envie um arquivo PDF no campo \"file\".",
  empty_file: "O arquivo está vazio.",
  not_pdf: "Esse arquivo não é um PDF nem um documento do Word (.docx).",
  docx_encrypted: "Esse documento tem senha. Tire a senha e envie de novo.",
  docx_invalid: "Não deu pra abrir esse documento do Word. Ele pode estar corrompido.",
  docx_no_text: "Esse documento do Word não tem texto.",
  docx_too_large: "Esse documento do Word é grande demais por dentro.",
  pdf_encrypted: "Esse PDF tem senha. Tire a senha e envie de novo.",
  pdf_invalid: "Não deu pra abrir esse PDF. Ele pode estar corrompido.",
  too_many_pages: `O PDF passa do limite de ${MAX_PDF_PAGES} páginas.`,
  too_many_docs: `Esse agente já tem ${MAX_DOCS_PER_AGENT} PDFs. Apague algum antes de enviar outro.`,
  queue_unavailable: "Não deu pra colocar o PDF na fila agora. Tente de novo em alguns minutos.",
};

function failure(status: number, code: string): UploadOutcome {
  return { ok: false, status, code, message: MESSAGES[code] ?? "Não deu pra enviar o PDF." };
}

/** Nome só pra mostrar na lista. Sem caminho, sem caractere estranho. */
export function cleanFileName(name: string | undefined | null): string {
  const base = (name ?? "").split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f\u007f<>"'`]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
  return clean || "documento.pdf";
}

/** Corpo grande demais, pelo Content-Length (antes de ler qualquer byte). */
export function bodyTooLarge(request: Request): boolean {
  const length = Number(request.headers.get("content-length") ?? "");
  return Number.isFinite(length) && length > MAX_UPLOAD_BODY_BYTES;
}

export async function handleKnowledgeUpload(
  request: Request,
  scope: CerebroScope,
  agentKind: AgentKind,
  deps: UploadDeps
): Promise<UploadOutcome> {
  if (bodyTooLarge(request)) return failure(413, "too_large");

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return failure(400, "no_file");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return failure(400, "no_file");
  if (file.size === 0) return failure(400, "empty_file");
  if (file.size > MAX_PDF_BYTES) return failure(413, "too_large");

  const bytes = new Uint8Array(await file.arrayBuffer());
  // Tipo pelo conteúdo: o Content-Type e o nome vêm do navegador e mentem.
  let data: Uint8Array = bytes;
  let pageCount: number;
  if (isPdfBytes(bytes)) {
    try {
      pageCount = await (deps.countPages ?? countPdfPages)(bytes);
    } catch (error) {
      return failure(400, error instanceof PdfError ? error.code : "pdf_invalid");
    }
    if (pageCount > MAX_PDF_PAGES) return failure(400, "too_many_pages");
  } else if (isZipBytes(bytes) || isCfbBytes(bytes)) {
    try {
      data = encodeStoredText(extractDocxText(bytes, { maxChars: MAX_PDF_TEXT_CHARS }).text);
    } catch (error) {
      const code = error instanceof DocxError ? error.code : "docx_invalid";
      return failure(code === "not_docx" ? 415 : 400, code === "not_docx" ? "not_pdf" : code);
    }
    pageCount = 1;
  } else {
    return failure(415, "not_pdf");
  }

  if ((await deps.store.countDocuments(scope.workspaceId, agentKind)) >= MAX_DOCS_PER_AGENT) {
    return failure(409, "too_many_docs");
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const { document, duplicate } = await deps.store.createDocument(scope, {
    agentKind,
    sessionId: null,
    fileName: cleanFileName(file.name),
    sizeBytes: bytes.length,
    sha256,
    data,
    pageCount,
  });
  if (duplicate && (document.status === "ready" || document.status === "processing" || document.status === "queued")) {
    return { ok: true, status: 200, document, duplicate: true };
  }

  try {
    await deps.enqueue({ documentId: document.id, ownerUserId: document.ownerUserId, workspaceId: scope.workspaceId });
  } catch {
    await deps.store.markError(document.id, scope.workspaceId, "queue_unavailable").catch(() => undefined);
    return failure(503, "queue_unavailable");
  }
  return { ok: true, status: 202, document: { ...document, status: "queued", errorCode: null }, duplicate };
}

/** Documento como sai na API (sem bytes, sem hash). */
export function publicDocument(doc: KnowledgeDoc) {
  return {
    id: doc.id,
    agentKind: doc.agentKind,
    fileName: doc.fileName,
    sizeBytes: doc.sizeBytes,
    pageCount: doc.pageCount,
    status: doc.status,
    errorCode: doc.errorCode,
    chunkCount: doc.chunkCount,
    embeddingModel: doc.embeddingModel,
    embeddingTokens: doc.embeddingTokens,
    createdAt: doc.createdAt.toISOString(),
    processedAt: doc.processedAt ? doc.processedAt.toISOString() : null,
  };
}
