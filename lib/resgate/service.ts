/**
 * Resgatar comentários (28/10/2026).
 *
 * Pega os comentários de UM post que não viraram DM (grafia errada da palavra,
 * campanha desligada, falha), tira quem já recebeu / pediu pra parar / venceu
 * (resposta privada só vale 7 dias e UMA vez por comentário) e coloca cada um
 * no MESMO caminho do gatilho:
 *  - fluxo: startFlowRun (a função que o worker chama pro flow-start), com
 *    triggerKey própria; o envio, a pausa humana, o limite do plano e a
 *    resposta pública são os do fluxo, não uma cópia.
 *  - campanha: o mesmo job "process-comment" que o webhook enfileira.
 * O envio é em lote LENTO (1 comentário por job, com intervalo e teto por
 * hora), em segundo plano, pausa sozinho se a Meta devolver limite e nunca
 * apaga nem esconde comentário. dryRun só conta.
 */
import { prisma } from "@/lib/db/client";
import { getDMQueue, getRedisConnection } from "@/lib/queue/client";
import {
  getAllUserMedia,
  listAllMediaComments,
  type InstagramComment,
} from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/oauth";
import { noteMetaError } from "@/lib/channels/status";
import { startFlowRun, type FlowOutcome } from "@/lib/flows/engine";
import { dmBucketState } from "@/lib/utils/rate-limiter";
import { errorMessage } from "@/lib/messaging/errors";
import { RESGATE_STEP_JOB_NAME, resgateJobId, type ResgateStepJob } from "@/lib/resgate/jobs";
import {
  BUCKET_RESERVE,
  PRIVATE_REPLY_WINDOW_MS,
  RATE_LIMIT_PAUSE_MS,
  classifyComments,
  classifyFailure,
  hourlyPauseMs,
  nextDelayMs,
  normalizePace,
  parsePostRef,
  type Candidate,
  type ClassifyCounts,
  type Pace,
  type TriggerRule,
} from "@/lib/resgate/rules";

export const RESGATE_OFF_MESSAGE =
  "Resgatar comentários está desligado neste servidor (RESGATE_DISABLED=1 ou MCP_FLUXOS_DISABLED=1). Faça pela tela do Lead Engine.";

export function resgateDisabled(): boolean {
  return process.env.RESGATE_DISABLED === "1" || process.env.MCP_FLUXOS_DISABLED === "1";
}

const MAX_COMMENTS = Number(process.env.RESGATE_MAX_COMENTARIOS ?? 20_000);
const MAX_ATTEMPTS = 4;
const CHUNK = 1000;

function chunks<T>(list: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export type ResgateError = { ok: false; status: number; error: string; code?: string };

type Target = {
  kind: "flow" | "automation";
  id: string;
  name: string;
  workspaceId: string;
  /** InstagramAccount.id interno. */
  accountId: string;
  /** instagramId (o da Meta). */
  igId: string;
  accessToken: string;
  trigger: TriggerRule;
  sourceAutomationId: string | null;
  boundPostId: string | null;
  matchAnyPost: boolean;
  isActive: boolean;
};

async function loadTarget(
  workspaceId: string,
  ids: { flowId?: string | null; automationId?: string | null }
): Promise<Target | ResgateError> {
  if (!!ids.flowId === !!ids.automationId) {
    return { ok: false, status: 400, error: "Informe fluxoId OU automacaoId (só um dos dois).", code: "invalid_body" };
  }
  if (ids.flowId) {
    const flow = await prisma.flow.findFirst({
      where: { id: ids.flowId, workspaceId },
      include: { instagramAccount: true },
    });
    if (!flow) return { ok: false, status: 404, error: "Fluxo não encontrado neste workspace." };
    if (flow.triggerType !== "COMMENT") {
      return { ok: false, status: 409, error: "Só fluxo com gatilho de comentário em post pode ser resgatado.", code: "not_comment_flow" };
    }
    return {
      kind: "flow",
      id: flow.id,
      name: flow.name,
      workspaceId,
      accountId: flow.instagramAccountId,
      igId: flow.instagramAccount.instagramId,
      accessToken: flow.instagramAccount.accessToken ?? "",
      trigger: { matchAnyWord: flow.matchAnyWord, keywords: flow.keywords, wholeWordMatch: flow.wholeWordMatch },
      sourceAutomationId: flow.sourceAutomationId,
      boundPostId: flow.triggerPostId,
      matchAnyPost: flow.triggerMatchAnyPost,
      isActive: flow.isActive && Boolean(flow.published) && flow.instagramAccount.status === "ACTIVE",
    };
  }
  const automation = await prisma.automation.findFirst({
    where: { id: ids.automationId as string, workspaceId },
    include: { instagramAccount: true },
  });
  if (!automation) return { ok: false, status: 404, error: "Campanha não encontrada neste workspace." };
  if (automation.trigger !== "COMMENT") {
    return { ok: false, status: 409, error: "Só campanha de comentário em post pode ser resgatada.", code: "not_comment_campaign" };
  }
  return {
    kind: "automation",
    id: automation.id,
    name: automation.name,
    workspaceId,
    accountId: automation.instagramAccountId,
    igId: automation.instagramAccount.instagramId,
    accessToken: automation.instagramAccount.accessToken ?? "",
    trigger: { matchAnyWord: automation.matchAnyWord, keywords: automation.keywords, wholeWordMatch: automation.wholeWordMatch },
    sourceAutomationId: null,
    boundPostId: automation.postId,
    matchAnyPost: automation.matchAnyPost,
    isActive: automation.isActive && automation.instagramAccount.status === "ACTIVE",
  };
}

async function resolveMediaId(token: string, post: string | null | undefined, target: Target): Promise<{ mediaId: string } | ResgateError> {
  const parsed = post ? parsePostRef(post) : null;
  if (post && !parsed) return { ok: false, status: 400, error: "Não entendi o post. Mande o link do Reel/post ou o id da mídia.", code: "invalid_post" };
  if (parsed?.mediaId) return { mediaId: parsed.mediaId };
  if (!parsed) {
    if (target.boundPostId) return { mediaId: target.boundPostId };
    return { ok: false, status: 400, error: "Informe o post (link ou id): este alvo não está preso a um post só.", code: "post_required" };
  }
  const media = await getAllUserMedia(token, 500);
  const found = media.find((m) => (m as { permalink?: string }).permalink?.includes(`/${parsed.shortcode}`));
  if (!found) {
    return { ok: false, status: 404, error: `Não achei o post ${parsed.shortcode} nos últimos 500 posts da conta. Mande o id da mídia.`, code: "post_not_found" };
  }
  return { mediaId: found.id };
}

export type PlanParams = {
  workspaceId: string;
  createdBy?: string | null;
  post?: string | null;
  flowId?: string | null;
  automationId?: string | null;
  dryRun?: boolean;
  limite?: number | null;
  desde?: string | null;
  palavrasExtras?: string[];
  tolerarGrafia?: boolean;
  intervaloMinSegundos?: number;
  intervaloMaxSegundos?: number;
  tetoPorHora?: number;
  now?: Date;
};

export type PlanResult =
  | ResgateError
  | {
      ok: true;
      dryRun: boolean;
      runId: string | null;
      alvo: { tipo: "fluxo" | "campanha"; id: string; nome: string };
      mediaId: string;
      leituraCompleta: boolean;
      contagens: ClassifyCounts;
      amostra: Record<string, unknown>[];
      ritmo: Pace & { duracaoEstimadaMinutos: number };
      avisos: string[];
    };

async function servedSets(target: Target, authorIds: string[], commentIds: string[]) {
  const servedCommentIds = new Set<string>();
  for (const part of chunks(commentIds)) {
    const [logs, runs, items] = await Promise.all([
      prisma.dmLog.findMany({ where: { commentId: { in: part }, status: "SENT" }, select: { commentId: true } }),
      prisma.flowRun.findMany({ where: { triggerCommentId: { in: part }, privateReplyUsed: true }, select: { triggerCommentId: true } }),
      prisma.resgateItem.findMany({ where: { commentId: { in: part }, status: "SENT" }, select: { commentId: true } }),
    ]);
    for (const l of logs ?? []) servedCommentIds.add(l.commentId);
    for (const r of runs ?? []) if (r.triggerCommentId) servedCommentIds.add(r.triggerCommentId);
    for (const i of items ?? []) servedCommentIds.add(i.commentId);
  }

  const servedPersonIds = new Set<string>();
  const personSources: Promise<void>[] = [];
  if (target.kind === "flow") {
    personSources.push(
      prisma.flowRun.findMany({ where: { flowId: target.id, privateReplyUsed: true }, select: { igUserId: true } }).then((rows) => {
        for (const r of rows ?? []) servedPersonIds.add(r.igUserId);
      }),
      prisma.resgateItem.findMany({ where: { status: "SENT", run: { flowId: target.id } }, select: { igUserId: true } }).then((rows) => {
        for (const r of rows ?? []) servedPersonIds.add(r.igUserId);
      })
    );
  }
  const automationId = target.kind === "automation" ? target.id : target.sourceAutomationId;
  if (automationId) {
    personSources.push(
      prisma.dmLog.findMany({ where: { automationId, status: "SENT" }, select: { commenterId: true } }).then((rows) => {
        for (const r of rows ?? []) servedPersonIds.add(r.commenterId);
      })
    );
    if (target.kind === "automation") {
      personSources.push(
        prisma.resgateItem.findMany({ where: { status: "SENT", run: { automationId } }, select: { igUserId: true } }).then((rows) => {
          for (const r of rows ?? []) servedPersonIds.add(r.igUserId);
        })
      );
    }
  }
  await Promise.all(personSources);

  const pendingElsewhere = new Set<string>();
  const open = await prisma.resgateItem.findMany({
    where: {
      status: { in: ["PENDING", "SENDING"] },
      run: { status: { in: ["RUNNING", "PAUSED"] }, ...(target.kind === "flow" ? { flowId: target.id } : { automationId: target.id }) },
    },
    select: { igUserId: true },
  });
  for (const r of open ?? []) pendingElsewhere.add(r.igUserId);

  const optOutPersonIds = new Set<string>();
  const takeoverPersonIds = new Set<string>();
  const now = new Date();
  for (const part of chunks(authorIds)) {
    const contacts = await prisma.contact.findMany({
      where: { workspaceId: target.workspaceId, instagramAccountId: target.accountId, igUserId: { in: part } },
      select: { igUserId: true, broadcastOptOutAt: true, humanTakeover: true, humanTakeoverUntil: true },
    });
    for (const c of contacts ?? []) {
      if (c.broadcastOptOutAt) optOutPersonIds.add(c.igUserId);
      if (c.humanTakeover && (!c.humanTakeoverUntil || c.humanTakeoverUntil > now)) takeoverPersonIds.add(c.igUserId);
    }
  }

  const moderatedCommentIds = new Set<string>();
  for (const part of chunks(commentIds)) {
    const rows = await prisma.commentModeration.findMany({
      where: { commentId: { in: part }, action: "HIDDEN" },
      select: { commentId: true },
    });
    for (const r of rows ?? []) moderatedCommentIds.add(r.commentId);
  }
  return { servedCommentIds, servedPersonIds, pendingElsewhere, optOutPersonIds, takeoverPersonIds, moderatedCommentIds };
}

export function brasilia(date: Date): string {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("weekday")}, ${get("day")}/${get("month")} ${get("hour")}:${get("minute")}`;
}

async function audit(workspaceId: string, message: string, payload: Record<string, unknown>, level: "INFO" | "WARNING" = "INFO") {
  await prisma.operationalEvent
    .create({ data: { workspaceId, source: "SYSTEM", level, message, payload: payload as never } })
    .catch(() => undefined);
}

export async function enqueueResgateStep(run: { id: string; igId: string }, delayMs: number, tag: string | number = Date.now()) {
  const data: ResgateStepJob = { instagramAccountId: run.igId, runId: run.id };
  await getDMQueue().add(RESGATE_STEP_JOB_NAME, data as never, {
    jobId: resgateJobId(run.id, tag),
    ...(delayMs > 0 ? { delay: delayMs } : {}),
    attempts: 1,
  });
}

export async function planResgate(p: PlanParams): Promise<PlanResult> {
  const now = p.now ?? new Date();
  const dryRun = p.dryRun !== false;
  if (!dryRun && resgateDisabled()) return { ok: false, status: 503, error: RESGATE_OFF_MESSAGE, code: "resgate_disabled" };

  const target = await loadTarget(p.workspaceId, { flowId: p.flowId, automationId: p.automationId });
  if ("ok" in target) return target;
  if (!target.isActive) {
    return {
      ok: false,
      status: 409,
      error: `${target.kind === "flow" ? "O fluxo" : "A campanha"} "${target.name}" está desligado. Ligue pela tela e rode de novo (o envio usa as regras dele).`,
      code: "target_off",
    };
  }
  if (!target.accessToken) return { ok: false, status: 409, error: "Conta do Instagram sem token. Reconecte pela tela.", code: "no_token" };
  let token: string;
  try {
    token = decryptToken(target.accessToken);
  } catch {
    return { ok: false, status: 409, error: "Não consegui ler o token da conta. Reconecte pela tela.", code: "no_token" };
  }
  let since: Date | null = null;
  if (p.desde) {
    since = new Date(p.desde);
    if (Number.isNaN(since.getTime())) return { ok: false, status: 400, error: "desde precisa ser data ISO, ex.: 2026-10-23T00:00:00-03:00", code: "invalid_body" };
  }
  const limite = p.limite && p.limite > 0 ? Math.floor(p.limite) : null;

  let media: { mediaId: string } | ResgateError;
  let read: { comments: InstagramComment[]; truncated: boolean };
  try {
    media = await resolveMediaId(token, p.post, target);
    if ("ok" in media) return media;
    read = await listAllMediaComments(token, media.mediaId, MAX_COMMENTS);
  } catch (error) {
    await noteMetaError({ id: target.accountId }, error).catch(() => undefined);
    return { ok: false, status: 502, error: `A Meta recusou a leitura dos comentários (${errorMessage(error).slice(0, 200)}). Nada foi enviado.`, code: "meta_read_failed" };
  }

  const trigger: TriggerRule = {
    ...target.trigger,
    extraWords: p.palavrasExtras?.map((w) => w.trim()).filter(Boolean),
    tolerateTypos: Boolean(p.tolerarGrafia),
  };
  const authorIds = [...new Set(read.comments.map((c) => c.from?.id).filter((x): x is string => Boolean(x)))];
  const sets = await servedSets(target, authorIds, read.comments.map((c) => c.id));
  const { candidates: all, counts } = classifyComments({
    comments: read.comments,
    ownIgUserIds: [target.igId],
    now,
    since,
    trigger,
    ...sets,
  });
  const candidates = limite ? all.slice(0, limite) : all;
  const pace = normalizePace(p);
  const avgSec = (pace.intervaloMinMs + pace.intervaloMaxMs) / 2000;
  const perHourByInterval = 3600 / avgSec;
  const effPerHour = Math.max(1, Math.min(pace.tetoHora, perHourByInterval));
  const avisos: string[] = [];
  if (read.truncated) avisos.push(`Li só os primeiros ${MAX_COMMENTS} comentários (teto). Os mais antigos podem ter ficado de fora.`);
  if (limite && all.length > limite) avisos.push(`limite=${limite}: ${all.length - limite} elegíveis ficaram de fora desta execução.`);
  if (counts.elegiveisPorGrafia > 0) avisos.push(`${counts.elegiveisPorGrafia} entram por grafia/variação da palavra. Confira a amostra antes de executar.`);
  avisos.push("Só comentários de topo: respostas dentro de comentário não recebem DM. Comentário apagado ou de conta restrita pode não vir da Meta.");

  const first = candidates[0];
  const result = {
    ok: true as const,
    dryRun,
    alvo: { tipo: (target.kind === "flow" ? "fluxo" : "campanha") as "fluxo" | "campanha", id: target.id, nome: target.name },
    mediaId: media.mediaId,
    leituraCompleta: !read.truncated,
    contagens: counts,
    amostra: candidates.slice(0, 10).map((c) => ({
      usuario: c.username,
      comentario: c.text.length > 80 ? `${c.text.slice(0, 80)}...` : c.text,
      casouPor: c.matchedBy,
      comentouEm: brasilia(c.commentAt),
      venceEm: brasilia(new Date(c.commentAt.getTime() + PRIVATE_REPLY_WINDOW_MS)),
    })),
    ritmo: { ...pace, duracaoEstimadaMinutos: Math.ceil((candidates.length / effPerHour) * 60) },
    avisos,
  };
  void first;
  if (dryRun) return { ...result, runId: null };

  if (candidates.length === 0) return { ...result, runId: null, avisos: [...avisos, "Nada a enviar: ninguém elegível."] };

  const open = await prisma.resgateRun.findFirst({
    where: {
      workspaceId: p.workspaceId,
      mediaId: media.mediaId,
      status: { in: ["RUNNING", "PAUSED"] },
      ...(target.kind === "flow" ? { flowId: target.id } : { automationId: target.id }),
    },
    select: { id: true },
  });
  if (open) {
    return { ok: false, status: 409, error: `Já existe uma execução aberta para este alvo e post (${open.id}). Veja o andamento, pause ou cancele antes de criar outra.`, code: "already_running" };
  }
  const run = await prisma.resgateRun.create({
    data: {
      workspaceId: p.workspaceId,
      instagramAccountId: target.accountId,
      flowId: target.kind === "flow" ? target.id : null,
      automationId: target.kind === "automation" ? target.id : null,
      mediaId: media.mediaId,
      postRef: p.post ?? null,
      status: "RUNNING",
      intervaloMinMs: pace.intervaloMinMs,
      intervaloMaxMs: pace.intervaloMaxMs,
      tetoHora: pace.tetoHora,
      planSummary: counts as never,
      createdBy: p.createdBy ?? null,
    },
    select: { id: true },
  });
  for (const part of chunks(candidates)) {
    await prisma.resgateItem.createMany({
      data: part.map((c) => ({
        runId: run.id,
        commentId: c.commentId,
        igUserId: c.igUserId,
        username: c.username,
        text: c.text,
        commentAt: c.commentAt,
      })),
      skipDuplicates: true,
    });
  }
  await audit(p.workspaceId, "Resgate de comentários: execução criada", {
    runId: run.id,
    alvo: result.alvo,
    mediaId: media.mediaId,
    createdBy: p.createdBy ?? null,
    contagens: counts,
    enfileirados: candidates.length,
    ritmo: pace,
  });
  await enqueueResgateStep({ id: run.id, igId: target.igId }, 1_000, "start");
  return { ...result, runId: run.id };
}

// ─── Envio ───────────────────────────────────────────────────────────────────

export type ItemDecision =
  | { item: "SENT" | "FAILED" | "SKIPPED"; reason: string; pause?: { ms: number; reason: string }; abort?: string }
  | { item: "RETRY"; reason: string; pause?: { ms: number; reason: string }; abort?: string };

/** Traduz o que o fluxo fez com o comentário no que o lote faz com o item (puro). */
export function decideFlowOutcome(
  outcome: FlowOutcome,
  run: { privateReplyUsed: boolean; status: string; stopReason: string | null } | null
): ItemDecision {
  if (run?.privateReplyUsed) return { item: "SENT", reason: "resposta privada enviada" };
  if (outcome === "skipped") return { item: "RETRY", reason: "fluxo desligado ou conta fora do ar", abort: "O fluxo não está ligado/publicado (ou a conta saiu do ar). Execução pausada." };
  if (outcome === "duplicate") return { item: "SKIPPED", reason: "já existia execução igual do fluxo" };
  if (outcome === "busy") return { item: "RETRY", reason: "pessoa no meio de outro fluxo" };
  if (!run) return { item: "FAILED", reason: "o fluxo não registrou a execução" };
  if (run.status === "STOPPED_TAKEOVER") return { item: "SKIPPED", reason: "atendimento humano assumiu a conversa" };
  if (run.status === "STOPPED_LIMIT") {
    if (run.stopReason === "monthly_limit") return { item: "RETRY", reason: "limite mensal do plano", pause: { ms: 6 * 3_600_000, reason: "limite mensal do plano" } };
    return { item: "RETRY", reason: "limite por hora do Lead Engine", pause: { ms: RATE_LIMIT_PAUSE_MS, reason: "limite por hora" } };
  }
  if (run.status === "STOPPED_OFF") return { item: "RETRY", reason: "canal desconectado", abort: "Canal do Instagram desconectado. Execução pausada." };
  if (run.status === "FAILED" || run.status === "STOPPED_WINDOW") {
    const f = classifyFailure(run.status === "STOPPED_WINDOW" ? "window_closed" : run.stopReason);
    if (f.kind === "rate_limit") return { item: "RETRY", reason: f.label, pause: { ms: RATE_LIMIT_PAUSE_MS, reason: f.label } };
    if (f.kind === "canal_off") return { item: "RETRY", reason: f.label, abort: `${f.label}. Execução pausada.` };
    return { item: "FAILED", reason: f.label };
  }
  // Fluxo andando mas a primeira mensagem ainda não saiu (ex.: espera/condição antes dela).
  return { item: "SENT", reason: "fluxo em andamento (a mensagem sai conforme o fluxo)" };
}

async function pauseRun(runId: string, ms: number, reason: string) {
  await prisma.resgateRun.update({
    where: { id: runId },
    data: { status: "PAUSED", pausedUntil: new Date(Date.now() + ms), pauseReason: reason.slice(0, 300) },
  });
}

/** Itens de campanha já passaram pelo process-comment: o resultado está no DmLog. */
export async function refreshCampaignItems(runId: string, automationId: string): Promise<void> {
  const waiting = await prisma.resgateItem.findMany({
    where: { runId, status: "SENDING" },
    select: { id: true, commentId: true, processedAt: true },
    take: 500,
  });
  if (!waiting?.length) return;
  const logs = await prisma.dmLog.findMany({
    where: { automationId, commentId: { in: waiting.map((w) => w.commentId) } },
    select: { commentId: true, status: true, errorMessage: true },
  });
  const byComment = new Map((logs ?? []).map((l) => [l.commentId, l]));
  for (const w of waiting) {
    const log = byComment.get(w.commentId);
    let status: string | null = null;
    let reason: string | null = null;
    if (log?.status === "SENT") status = "SENT";
    else if (log?.status === "FAILED") {
      status = "FAILED";
      reason = classifyFailure(log.errorMessage).label;
    } else if (log && log.status !== "PENDING") {
      status = "SKIPPED";
      reason = (log.errorMessage ?? log.status).slice(0, 200);
    } else if (!log && w.processedAt && Date.now() - w.processedAt.getTime() > 2 * 3_600_000) {
      status = "FAILED";
      reason = "a campanha não registrou o comentário (não casou ou a fila parou)";
    }
    if (status) await prisma.resgateItem.update({ where: { id: w.id }, data: { status, reason } });
  }
}

export type StepResult = "sent" | "failed" | "skipped" | "retry" | "paused" | "done" | "idle" | "locked" | "off";

/** Um item por chamada; agenda a próxima sozinho. Nunca lança por causa de um comentário. */
export async function runResgateStep(data: ResgateStepJob, now: Date = new Date()): Promise<StepResult> {
  const run = await prisma.resgateRun.findUnique({ where: { id: data.runId } });
  if (!run || run.status !== "RUNNING") return "idle";

  if (resgateDisabled()) {
    await pauseRun(run.id, 3_600_000, "interruptor de emergência (RESGATE_DISABLED / MCP_FLUXOS_DISABLED)");
    return "off";
  }
  // Uma corrente por execução: dois jobs ao mesmo tempo furariam o ritmo. O
  // cadeado dura só o passo (30 s de segurança se o worker morrer).
  const redis = getRedisConnection();
  const lockKey = `resgate:lock:${run.id}`;
  const gotLock = await redis.set(lockKey, "1", "PX", 30_000, "NX").catch(() => "OK");
  if (gotLock !== "OK") return "locked";
  try {
    await prisma.resgateRun.update({ where: { id: run.id }, data: { updatedAt: now } }).catch(() => undefined);
    return await stepInner(run, data.instagramAccountId, now);
  } finally {
    await redis.del(lockKey).catch(() => undefined);
  }
}

type RunRow = NonNullable<Awaited<ReturnType<typeof prisma.resgateRun.findUnique>>>;

async function stepInner(run: RunRow, igId: string, now: Date): Promise<StepResult> {
  const pace: Pace = { intervaloMinMs: run.intervaloMinMs, intervaloMaxMs: run.intervaloMaxMs, tetoHora: run.tetoHora };
  const next = (ms?: number, tag?: string) => enqueueResgateStep({ id: run.id, igId }, ms ?? nextDelayMs(pace), tag ?? Date.now());

  // Teto por hora desta execução e folga no balde da Meta (compartilhado com os webhooks).
  const recent = await prisma.resgateItem.findMany({
    where: { runId: run.id, status: { in: ["SENT", "SENDING", "FAILED"] }, processedAt: { gte: new Date(now.getTime() - 3_600_000) } },
    select: { processedAt: true },
  });
  const wait = hourlyPauseMs((recent ?? []).map((r) => r.processedAt?.getTime() ?? 0), run.tetoHora, now.getTime());
  if (wait > 0) {
    await pauseRun(run.id, wait, "teto por hora da execução");
    return "paused";
  }
  const bucket = await dmBucketState(igId).catch(() => null);
  if (bucket && bucket.count >= bucket.max - BUCKET_RESERVE) {
    await pauseRun(run.id, Math.max(bucket.ttlMs, 60_000) + 1_000, "balde de respostas privadas da Meta quase cheio (750/h)");
    return "paused";
  }

  const item = await prisma.resgateItem.findFirst({ where: { runId: run.id, status: "PENDING" }, orderBy: { commentAt: "asc" } });
  if (!item) {
    if (run.automationId) await refreshCampaignItems(run.id, run.automationId);
    const stillOpen = await prisma.resgateItem.count({ where: { runId: run.id, status: { in: ["PENDING", "SENDING"] } } });
    if (stillOpen === 0 || !run.automationId) {
      await prisma.resgateRun.update({ where: { id: run.id }, data: { status: "DONE", finishedAt: now } });
      await audit(run.workspaceId, "Resgate de comentários: execução concluída", { runId: run.id });
      return "done";
    }
    await next(60_000, `wait${Math.floor(now.getTime() / 60_000)}`);
    return "idle";
  }
  const claim = await prisma.resgateItem.updateMany({ where: { id: item.id, status: "PENDING" }, data: { status: "SENDING", attempts: { increment: 1 }, processedAt: now } });
  if (claim.count === 0) {
    await next(500);
    return "locked";
  }
  const attempt = item.attempts + 1;

  // Venceu enquanto esperava na fila.
  if (now.getTime() - item.commentAt.getTime() > PRIVATE_REPLY_WINDOW_MS - 60_000) {
    await prisma.resgateItem.update({ where: { id: item.id }, data: { status: "SKIPPED", reason: "venceu: passou de 7 dias", processedAt: now } });
    await next(200);
    return "skipped";
  }
  // Pediu pra parar ou um humano assumiu desde o planejamento.
  const contact = await prisma.contact.findFirst({
    where: { workspaceId: run.workspaceId, instagramAccountId: run.instagramAccountId, igUserId: item.igUserId },
    select: { broadcastOptOutAt: true, humanTakeover: true, humanTakeoverUntil: true },
  });
  if (contact?.broadcastOptOutAt || (contact?.humanTakeover && (!contact.humanTakeoverUntil || contact.humanTakeoverUntil > now))) {
    await prisma.resgateItem.update({
      where: { id: item.id },
      data: { status: "SKIPPED", reason: contact.broadcastOptOutAt ? "pediu pra parar (opt-out)" : "atendimento humano assumiu", processedAt: now },
    });
    await next(200);
    return "skipped";
  }
  // Alguém respondeu esse comentário no meio tempo (webhook ou outra campanha).
  const done = await prisma.dmLog.findFirst({ where: { commentId: item.commentId, status: "SENT" }, select: { id: true } });
  if (done) {
    await prisma.resgateItem.update({ where: { id: item.id }, data: { status: "SKIPPED", reason: "já recebeu resposta privada deste comentário", processedAt: now } });
    await next(200);
    return "skipped";
  }

  let decision: ItemDecision;
  try {
    if (run.flowId) {
      const triggerKey = `resgate:${item.commentId}:${attempt}`;
      const outcome = await startFlowRun(
        {
          instagramAccountId: igId,
          flowId: run.flowId,
          kind: "COMMENT",
          triggerKey,
          triggerRef: item.commentId,
          igUserId: item.igUserId,
          username: item.username,
          text: item.text,
          inboundAt: null,
        },
        now
      );
      const flowRun = await prisma.flowRun.findFirst({
        where: { flowId: run.flowId, triggerKey },
        select: { privateReplyUsed: true, status: true, stopReason: true },
      });
      decision = decideFlowOutcome(outcome, flowRun ?? null);
    } else {
      await getDMQueue().add("process-comment", {
        instagramAccountId: igId,
        commentId: item.commentId,
        commentText: item.text,
        commenterId: item.igUserId,
        commenterName: item.username ?? undefined,
        mediaId: run.mediaId,
        source: "POLLING",
      } as never);
      // O resultado vem do DmLog (refreshCampaignItems); fica SENDING até lá.
      await prisma.resgateItem.update({ where: { id: item.id }, data: { reason: "na fila da campanha", processedAt: now } });
      await next();
      return "sent";
    }
  } catch (error) {
    await noteMetaError({ id: run.instagramAccountId }, error).catch(() => undefined);
    const f = classifyFailure(errorMessage(error));
    decision =
      f.kind === "rate_limit"
        ? { item: "RETRY", reason: f.label, pause: { ms: RATE_LIMIT_PAUSE_MS, reason: f.label } }
        : f.kind === "canal_off"
          ? { item: "RETRY", reason: f.label, abort: `${f.label}. Execução pausada.` }
          : { item: "FAILED", reason: f.label };
  }

  let itemStatus: "PENDING" | "SENT" | "FAILED" | "SKIPPED" = decision.item === "RETRY" ? "PENDING" : decision.item;
  let reason = decision.reason;
  if (itemStatus === "PENDING" && attempt >= MAX_ATTEMPTS) {
    itemStatus = "FAILED";
    reason = `${reason} (${MAX_ATTEMPTS} tentativas)`;
  }
  await prisma.resgateItem.update({ where: { id: item.id }, data: { status: itemStatus, reason: reason.slice(0, 300), processedAt: now } });
  if (decision.abort) {
    await pauseRun(run.id, 6 * 3_600_000, decision.abort);
    await audit(run.workspaceId, "Resgate de comentários: execução pausada", { runId: run.id, motivo: decision.abort }, "WARNING");
    return "paused";
  }
  if (decision.pause) {
    await pauseRun(run.id, decision.pause.ms, decision.pause.reason);
    await audit(run.workspaceId, "Resgate de comentários: pausa automática", { runId: run.id, motivo: decision.pause.reason, ms: decision.pause.ms }, "WARNING");
    return "paused";
  }
  await next();
  return itemStatus === "SENT" ? "sent" : itemStatus === "FAILED" ? "failed" : itemStatus === "SKIPPED" ? "skipped" : "retry";
}

/** Rodado pelo messaging-sweep (a cada 5 min): retoma pausadas vencidas e correntes que morreram. */
export async function sweepResgates(now: Date = new Date()): Promise<{ resumed: number }> {
  if (resgateDisabled()) return { resumed: 0 };
  let resumed = 0;
  const paused = await prisma.resgateRun.findMany({
    where: { status: "PAUSED", pausedUntil: { lte: now } },
    select: { id: true, instagramAccountId: true },
    take: 20,
  });
  const stalled = await prisma.resgateRun.findMany({
    where: { status: "RUNNING", updatedAt: { lt: new Date(now.getTime() - 5 * 60_000) } },
    select: { id: true, instagramAccountId: true },
    take: 20,
  });
  const tag = `sweep${Math.floor(now.getTime() / 60_000)}`;
  for (const r of [...(paused ?? []), ...(stalled ?? [])]) {
    const account = await prisma.instagramAccount.findUnique({ where: { id: r.instagramAccountId }, select: { instagramId: true } });
    if (!account) continue;
    await prisma.resgateRun.update({ where: { id: r.id }, data: { status: "RUNNING", pausedUntil: null, pauseReason: null } });
    await enqueueResgateStep({ id: r.id, igId: account.instagramId }, 0, tag).catch(() => undefined);
    resumed += 1;
  }
  return { resumed };
}

// ─── Leitura e controle ─────────────────────────────────────────────────────

export async function resgateReport(workspaceId: string, runId: string) {
  const run = await prisma.resgateRun.findFirst({ where: { id: runId, workspaceId } });
  if (!run) return null;
  if (run.automationId) await refreshCampaignItems(run.id, run.automationId).catch(() => undefined);
  const grouped = await prisma.resgateItem.groupBy({ by: ["status"], where: { runId }, _count: { _all: true } });
  const counts: Record<string, number> = { PENDING: 0, SENDING: 0, SENT: 0, FAILED: 0, SKIPPED: 0 };
  for (const g of grouped ?? []) counts[g.status] = g._count._all;
  const reasonsRaw = await prisma.resgateItem.groupBy({
    by: ["status", "reason"],
    where: { runId, status: { in: ["FAILED", "SKIPPED"] } },
    _count: { _all: true },
  });
  const porMotivo = (reasonsRaw ?? [])
    .map((r) => ({ estado: r.status === "FAILED" ? "falha" : "pulado", motivo: r.reason ?? "sem motivo", quantidade: r._count._all }))
    .sort((a, b) => b.quantidade - a.quantidade);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    id: run.id,
    estado: run.status,
    pausadoAte: run.pausedUntil ? brasilia(run.pausedUntil) : null,
    motivoDaPausa: run.pauseReason,
    criadoEm: brasilia(run.createdAt),
    mediaId: run.mediaId,
    alvo: run.flowId ? { tipo: "fluxo", id: run.flowId } : { tipo: "campanha", id: run.automationId },
    ritmo: { intervaloMinMs: run.intervaloMinMs, intervaloMaxMs: run.intervaloMaxMs, tetoPorHora: run.tetoHora },
    planejamento: run.planSummary,
    total,
    enviados: counts.SENT,
    naFila: counts.PENDING + counts.SENDING,
    falhas: counts.FAILED,
    pulados: counts.SKIPPED,
    porMotivo,
  };
}

export async function listResgates(workspaceId: string, limit = 10) {
  const rows = await prisma.resgateRun.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: limit, select: { id: true, status: true, createdAt: true, mediaId: true, flowId: true, automationId: true } });
  return (rows ?? []).map((r) => ({ id: r.id, estado: r.status, criadoEm: brasilia(r.createdAt), mediaId: r.mediaId, alvo: r.flowId ?? r.automationId }));
}

export async function controlResgate(workspaceId: string, runId: string, acao: "pausar" | "retomar" | "cancelar") {
  const run = await prisma.resgateRun.findFirst({ where: { id: runId, workspaceId } });
  if (!run) return { ok: false as const, status: 404, error: "Execução não encontrada." };
  if (run.status === "DONE" || run.status === "CANCELED") return { ok: false as const, status: 409, error: `A execução já está ${run.status}.` };
  if (acao === "pausar") {
    await prisma.resgateRun.update({ where: { id: run.id }, data: { status: "PAUSED", pausedUntil: null, pauseReason: "pausado pelo dono" } });
  } else if (acao === "cancelar") {
    await prisma.resgateRun.update({ where: { id: run.id }, data: { status: "CANCELED", finishedAt: new Date(), pauseReason: "cancelado pelo dono" } });
  } else {
    if (resgateDisabled()) return { ok: false as const, status: 503, error: RESGATE_OFF_MESSAGE };
    const account = await prisma.instagramAccount.findUnique({ where: { id: run.instagramAccountId }, select: { instagramId: true } });
    if (!account) return { ok: false as const, status: 404, error: "Conta do Instagram não encontrada." };
    await prisma.resgateRun.update({ where: { id: run.id }, data: { status: "RUNNING", pausedUntil: null, pauseReason: null } });
    await enqueueResgateStep({ id: run.id, igId: account.instagramId }, 500, `resume${Date.now()}`);
  }
  await audit(workspaceId, `Resgate de comentários: ${acao}`, { runId });
  return { ok: true as const, report: await resgateReport(workspaceId, runId) };
}

export type { Candidate };
