import { NextRequest } from "next/server";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { humanOnly } from "@/lib/flows/api";
import { hitRateLimit } from "@/lib/http-rate-limit";
import { UPLOAD_RATE_LIMIT } from "@/lib/whatsapp/cerebro/limits";
import { enqueueKnowledgeIngest } from "@/lib/whatsapp/cerebro/queue";
import { cerebroForUser } from "@/lib/whatsapp/cerebro/service";
import { isAgentKind } from "@/lib/whatsapp/cerebro/types";
import { bodyTooLarge, handleKnowledgeUpload, publicDocument } from "@/lib/whatsapp/cerebro/upload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteProps = { params: Promise<{ agent: string }> };

/**
 * PDFs da base de conhecimento de um agente (qualificacao, atendimento,
 * suporte). Só com sessão de pessoa logada: chave de API recebe 403 aqui e no
 * proxy.ts (a rota não está em lib/api-key-routes.ts).
 */
export async function GET(_request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext();
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("read the agent knowledge base");
  if (blocked) return blocked;

  const { agent } = await params;
  if (!isAgentKind(agent)) return fail("Agente inválido", 404, { code: "invalid_agent" });

  const { store } = await cerebroForUser(auth.context.userId, auth.context.workspaceId);
  const documents = await store.listDocuments(auth.context.workspaceId, agent);
  return ok({ documents: documents.map(publicDocument) });
}

export async function POST(request: NextRequest, { params }: RouteProps) {
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth.response;
  const blocked = await humanOnly("upload files");
  if (blocked) return blocked;

  const { agent } = await params;
  if (!isAgentKind(agent)) return fail("Agente inválido", 404, { code: "invalid_agent" });
  if (bodyTooLarge(request)) return fail("O PDF é grande demais", 413, { code: "too_large" });

  const limited = await hitRateLimit("wa-cerebro-upload", auth.context.userId, UPLOAD_RATE_LIMIT.limit, UPLOAD_RATE_LIMIT.windowSeconds);
  if (!limited.allowed) return fail("Muitos envios em pouco tempo. Tente de novo daqui a pouco.", 429, { code: "rate_limited" });

  const { store } = await cerebroForUser(auth.context.userId, auth.context.workspaceId);
  const outcome = await handleKnowledgeUpload(
    request,
    { ownerUserId: auth.context.userId, workspaceId: auth.context.workspaceId },
    agent,
    { store, enqueue: (job) => enqueueKnowledgeIngest(job) }
  );
  if (!outcome.ok) return fail(outcome.message, outcome.status, { code: outcome.code });
  return ok({ document: publicDocument(outcome.document), duplicate: outcome.duplicate }, outcome.status);
}
