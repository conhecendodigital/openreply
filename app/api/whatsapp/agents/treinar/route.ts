import { NextRequest } from "next/server";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { humanOnly } from "@/lib/flows/api";
import { hitRateLimit } from "@/lib/http-rate-limit";
import { MAX_PDF_BYTES } from "@/lib/whatsapp/cerebro/limits";
import { bodyTooLarge, cleanFileName } from "@/lib/whatsapp/cerebro/upload";
import { lerDocumento, type ErroLeitura } from "@/lib/whatsapp/treinar/ler";
import { depsTreinoDoAdmin } from "@/lib/whatsapp/treinar/servidor";
import { TREINO_RATE_LIMIT, treinarComDocumento } from "@/lib/whatsapp/treinar/treinar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A IA lê o documento inteiro: pode levar 1 a 2 minutos.
export const maxDuration = 300;

const ERRO_LEITURA: Record<ErroLeitura, string> = {
  not_supported: "Send a PDF or a Word document (.docx).",
  pdf_encrypted: "This PDF has a password. Send it without the password.",
  pdf_invalid: "Could not open this PDF. It may be damaged.",
  pdf_no_text: "This PDF has no text (only images). Send a PDF with selectable text.",
  too_many_pages: "This PDF has more than 200 pages.",
  docx_encrypted: "This Word document has a password. Send it without the password.",
  docx_invalid: "Could not open this Word document. It may be damaged.",
  docx_no_text: "This Word document has no text.",
  docx_too_large: "This Word document is too big inside.",
};

/**
 * "Treinar com um documento": recebe o briefing (PDF ou .docx, até 8 MB), lê o
 * texto, manda pra IA do /admin e devolve o RASCUNHO da tela Agentes.
 * Não grava nada (nem configuração, nem arquivo, nem texto): o dono confere e
 * clica em Salvar. Só dono ou admin do workspace, só sessão de pessoa logada
 * (chave de API e MCP recebem 403 aqui e no proxy.ts).
 */
export async function POST(request: NextRequest) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("train the WhatsApp agents");
  if (blocked) return blocked;
  if (bodyTooLarge(request)) return fail("The file is bigger than 8 MB.", 413, { code: "too_large" });

  const limited = await hitRateLimit("wa-treinar", auth.context.userId, TREINO_RATE_LIMIT.limit, TREINO_RATE_LIMIT.windowSeconds);
  if (!limited.allowed) return fail("Too many documents in a short time. Try again in a while.", 429, { code: "rate_limited" });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail("Send the file in the \"file\" field.", 400, { code: "no_file" });
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return fail("Send the file in the \"file\" field.", 400, { code: "no_file" });
  if (file.size === 0) return fail("The file is empty.", 400, { code: "empty_file" });
  if (file.size > MAX_PDF_BYTES) return fail("The file is bigger than 8 MB.", 413, { code: "too_large" });

  const leitura = await lerDocumento(new Uint8Array(await file.arrayBuffer()));
  if (!leitura.ok) return fail(ERRO_LEITURA[leitura.erro], leitura.erro === "not_supported" ? 415 : 400, { code: leitura.erro });

  const deps = await depsTreinoDoAdmin({ userId: auth.context.userId, workspaceId: auth.context.workspaceId });
  const r = await treinarComDocumento({ nome: cleanFileName(file.name), tipo: leitura.tipo, texto: leitura.texto, cortado: leitura.cortado }, deps);
  if (!r.ok) return fail(r.mensagem, r.status, { code: r.codigo });
  return ok({ rascunho: r.rascunho });
}
