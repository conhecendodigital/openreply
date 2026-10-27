/**
 * 27/10/2026: agendar e publicar pela chave (MCP), a pedido do dono da conta. Reaproveita
 * lib/social/post-actions.ts (mesma regra da tela). Travas contra BUG, não contra o dono:
 * só age em post que já existe (RASCUNHO ou AGENDADO) do workspace da chave, nunca cria nem apaga,
 * repetir o pedido não duplica, cada ação fica no registro (sem legenda nem arquivo) e a resposta
 * é lida do banco depois da ação. Interruptor de emergência: MCP_PUBLISH_DISABLED=1.
 */
import { NextRequest } from "next/server";
import { fail, ok, requireContext } from "@/lib/api-helpers";
import { getApiCaller } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { findPost } from "@/lib/social/posts-api";
import { publishPostAction, schedulePostAction } from "@/lib/social/post-actions";

export const MCP_PUBLISH_OFF_MESSAGE = "Agendar e publicar pelo MCP está desligado neste servidor (MCP_PUBLISH_DISABLED=1). Faça pela tela do Lead Engine.";

/** Horário de Brasília com dia da semana, ex.: "terça-feira, 28/10/2026 19:30". */
export function brasiliaLabel(date: Date): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")}, ${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")} (Brasília)`;
}

type Loaded = NonNullable<Awaited<ReturnType<typeof findPost>>>;

/** Resumo lido do banco, sem URL do arquivo nem configurações. */
export function summarize(post: Loaded, conferencia: "CONFERE" | "NÃO CONFERE", extra: Record<string, unknown> = {}) {
  const caption = (post.caption ?? "").replace(/\s+/g, " ").trim();
  return {
    conferencia,
    id: post.id,
    rede: post.platform,
    estado: post.status,
    horario: post.scheduledAt ? brasiliaLabel(post.scheduledAt) : null,
    horarioISO: post.scheduledAt ? post.scheduledAt.toISOString() : null,
    legenda: caption.length > 80 ? `${caption.slice(0, 80)}...` : caption,
    erro: post.lastError ?? null,
    ...extra,
  };
}

async function gate() {
  if (process.env.MCP_PUBLISH_DISABLED === "1") return { response: fail(MCP_PUBLISH_OFF_MESSAGE, 503, { code: "mcp_publish_disabled" }) };
  const auth = await requireContext({ manage: true });
  if ("response" in auth) return auth;
  const caller = await getApiCaller();
  if (caller.kind !== "token" || !caller.tokenId) return { response: fail("This route is for the MCP only. In the app, use the Posts tab.", 403, { code: "api_key_only" }) };
  return { context: auth.context, tokenId: caller.tokenId };
}

async function audit(g: { context: { workspaceId: string; userId: string }; tokenId: string }, action: string, post: Loaded, scheduledAt?: string) {
  try {
    await prisma.operationalEvent.create({
      data: {
        workspaceId: g.context.workspaceId,
        source: "SYSTEM",
        level: "INFO",
        message: `MCP: ${action}`,
        payload: { tokenId: g.tokenId, userId: g.context.userId, postId: post.id, platform: post.platform, fromStatus: post.status, ...(scheduledAt ? { scheduledAt } : {}) },
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function mcpSchedule(request: NextRequest, id: string) {
  const g = await gate();
  if ("response" in g) return g.response;
  const body = (await request.json().catch(() => null)) as { scheduledAt?: unknown } | null;
  const raw = body?.scheduledAt;
  // Offset obrigatório (Z ou +/-HH:MM): sem ele o horário seria um chute de fuso.
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(raw) || Number.isNaN(Date.parse(raw))) {
    return fail("Informe scheduledAt em ISO com fuso, ex.: 2026-10-28T19:30:00-03:00", 400, { code: "invalid_body" });
  }
  const when = new Date(raw);
  const post = await findPost(id, g.context.workspaceId);
  if (!post) return fail("Post not found", 404);
  if (post.status !== "DRAFT" && post.status !== "SCHEDULED") return fail(`Este post está ${post.status} e não pode ser agendado pelo MCP`, 409, { code: "not_editable" });
  // Idempotente: mesmo horário, já agendado.
  if (post.status === "SCHEDULED" && post.scheduledAt && post.scheduledAt.getTime() === when.getTime()) {
    return ok(summarize(post, "CONFERE", { aviso: "Já estava agendado para esse horário. Nada foi alterado." }));
  }
  if (!(await audit(g, "post agendado", post, when.toISOString()))) return fail("Could not record the action. Try again.", 500, { code: "audit_failed" });
  const result = await schedulePostAction(id, g.context.workspaceId, when);
  if (!result.ok) return fail(result.message, result.status, result.code ? { code: result.code } : undefined);
  const stored = await findPost(id, g.context.workspaceId);
  const matches = Boolean(stored && stored.status === "SCHEDULED" && stored.scheduledAt?.getTime() === when.getTime());
  return ok(summarize(stored ?? result.post, matches ? "CONFERE" : "NÃO CONFERE"));
}

export async function mcpPublish(id: string) {
  const g = await gate();
  if ("response" in g) return g.response;
  const post = await findPost(id, g.context.workspaceId);
  if (!post) return fail("Post not found", 404);
  // Idempotente: já saindo ou já publicado, não dispara de novo.
  if (post.status === "PUBLISHING" || post.status === "PUBLISHED") {
    return ok(summarize(post, "CONFERE", { aviso: "Este post já está sendo publicado ou já foi publicado. Nada foi feito de novo." }));
  }
  if (post.status !== "DRAFT" && post.status !== "SCHEDULED") return fail(`Este post está ${post.status} e não pode ser publicado pelo MCP`, 409, { code: "not_editable" });
  if (!(await audit(g, "post publicado agora", post))) return fail("Could not record the action. Try again.", 500, { code: "audit_failed" });
  const result = await publishPostAction(id, g.context.workspaceId);
  if (!result.ok) return fail(result.message, result.status, result.code ? { code: result.code } : undefined);
  const stored = await findPost(id, g.context.workspaceId);
  const matches = Boolean(stored && (stored.status === "PUBLISHING" || stored.status === "PUBLISHED"));
  return ok(summarize(stored ?? result.post, matches ? "CONFERE" : "NÃO CONFERE"), 202);
}
