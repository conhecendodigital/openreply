/**
 * Chaves de integração por workspace (Canais > Conexões e chaves, 06/10/2026).
 * Pedido do dono: "preciso que as apis e conexões fiquem tudo em canais para
 * colocar as chaves". Só no servidor.
 *
 * Serviços e campos:
 *   uazapi: serverUrl, adminToken, maxInstances (dispositivos do plano)
 *   openwa: baseUrl, apiKey (chave operator do gateway)
 *
 * PRECEDÊNCIA (a mesma em todo lugar: site, wa-worker, webhook, painel):
 *   1. o que o dono/admin do workspace salvou em Canais (URL + chave juntas);
 *   2. as variáveis de ambiente do servidor (UAZAPI_*, OPENWA_*), como sempre;
 *   3. não configurado.
 * Nunca mistura: uma URL salva no workspace nunca recebe a chave do ambiente
 * (senão um admin de workspace poderia apontar a URL pro servidor dele e
 * receber a chave do servidor). Só vale o conjunto completo de um lado só.
 *
 * Segurança:
 * - Valor cifrado com AES-256-GCM (encryptToken, mesma ENCRYPTION_KEY dos
 *   tokens da Meta). O navegador, a chave de API e o MCP nunca recebem o valor:
 *   só "configurada", os 4 últimos caracteres, quem trocou e quando.
 * - RLS (migração 20261018120000_canais_chaves): só dono/admin do workspace
 *   ativo lê e grava pelo le_app. Os workers leem pelo le_system.
 * - Cada salvar, trocar, remover e testar vira uma linha em
 *   WorkspaceIntegrationAudit (sem o valor).
 * - Cache curto (30 s) por processo; salvar ou remover limpa na hora no
 *   processo que salvou. Os outros processos (wa-worker) pegam em até 30 s.
 */
import type { PrismaClient } from "@/app/generated/prisma/client";
import { getPrisma } from "@/lib/db/client";
import { getAppPrisma, withRls, withSystemRole, type RlsContext } from "@/lib/db/rls";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import { checkPublicHttpsUrl, checkPublicUrlWithDns, type LookupAll, type UrlProblem } from "@/lib/integrations/url-guard";
import { UAZAPI_DEFAULT_MAX_INSTANCES, uazapiFromEnv } from "@/lib/whatsapp/uazapi";

export const INTEGRATION_FIELDS = {
  uazapi: { serverUrl: "url", adminToken: "secret", maxInstances: "number" },
  openwa: { baseUrl: "url", apiKey: "secret" },
} as const;

export type IntegrationService = keyof typeof INTEGRATION_FIELDS;
export type FieldKind = "url" | "secret" | "number";

export const INTEGRATION_SERVICES = Object.keys(INTEGRATION_FIELDS) as IntegrationService[];

export function isIntegrationService(value: unknown): value is IntegrationService {
  return typeof value === "string" && value in INTEGRATION_FIELDS;
}

export function fieldKind(service: IntegrationService, field: string): FieldKind | null {
  const fields = INTEGRATION_FIELDS[service] as Record<string, FieldKind>;
  return Object.prototype.hasOwnProperty.call(fields, field) ? fields[field] : null;
}

/** Os campos que formam o conjunto completo de cada serviço (o número do plano é opcional). */
const REQUIRED: Record<IntegrationService, string[]> = {
  uazapi: ["serverUrl", "adminToken"],
  openwa: ["baseUrl", "apiKey"],
};

type Env = Record<string, string | undefined>;

export type CredentialSource = "workspace" | "env";

export type ResolvedUazapi = { source: CredentialSource; serverUrl: string; adminToken: string; maxInstances: number };
export type ResolvedOpenwa = { source: CredentialSource; baseUrl: string; apiKey: string };

export type ResolveOptions = { env?: Env; system?: PrismaClient; now?: () => number };

/* ------------------------------------------------------------------------- */
/* Leitura no servidor (workers, webhook, painel)                            */
/* ------------------------------------------------------------------------- */

export const INTEGRATION_CACHE_TTL_MS = 30_000;

/** Salvar, trocar e remover: 20 por pessoa a cada 10 minutos. */
export const INTEGRATION_WRITE_LIMIT = { limit: 20, windowSeconds: 10 * 60 };

type CacheEntry = { at: number; values: Record<string, string> };
const cache = new Map<string, CacheEntry>();

/** Limpa o cache de um workspace (ou de todos). Chamado ao salvar e remover. */
export function invalidateIntegrationCache(workspaceId?: string): void {
  if (!workspaceId) {
    cache.clear();
    return;
  }
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${workspaceId}:`)) cache.delete(key);
  }
}

export class IntegrationReadError extends Error {
  constructor() {
    super("Não deu pra ler as chaves salvas em Canais");
    this.name = "IntegrationReadError";
  }
}

/**
 * Valores abertos de um serviço do workspace. {} = nada salvo.
 * Falha no banco lança IntegrationReadError (não cai pro ambiente às cegas).
 */
async function workspaceValues(workspaceId: string, service: IntegrationService, opts: ResolveOptions): Promise<Record<string, string>> {
  const key = `${workspaceId}:${service}`;
  const now = (opts.now ?? Date.now)();
  const hit = cache.get(key);
  if (hit && now - hit.at < INTEGRATION_CACHE_TTL_MS) return hit.values;
  let rows: Array<{ field: string; valueEnc: string }>;
  try {
    rows = await withSystemRole(
      (tx) => tx.workspaceIntegrationCredential.findMany({ where: { workspaceId, service }, select: { field: true, valueEnc: true } }),
      opts.system ?? getPrisma()
    );
  } catch {
    console.error(`[integrações] não deu pra ler as chaves de ${service} do workspace`);
    throw new IntegrationReadError();
  }
  const values: Record<string, string> = {};
  for (const row of rows) {
    try {
      values[row.field] = decryptToken(row.valueEnc);
    } catch {
      // ENCRYPTION_KEY trocada: o valor não abre. Sem detalhe no log.
      console.error(`[integrações] um valor de ${service} não abriu (ENCRYPTION_KEY mudou?)`);
    }
  }
  cache.set(key, { at: now, values });
  return values;
}

function complete(service: IntegrationService, values: Record<string, string>): boolean {
  return REQUIRED[service].every((f) => Boolean(values[f]));
}

function parseMax(value: string | undefined): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : UAZAPI_DEFAULT_MAX_INSTANCES;
}

/**
 * uazapi do workspace (Canais) > UAZAPI_* do ambiente > null.
 * Sem workspace (chamada antiga, ou teste), só o ambiente.
 */
export async function resolveUazapi(workspaceId: string | null | undefined, opts: ResolveOptions = {}): Promise<ResolvedUazapi | null> {
  if (workspaceId) {
    const values = await workspaceValues(workspaceId, "uazapi", opts);
    if (complete("uazapi", values)) {
      const url = checkPublicHttpsUrl(values.serverUrl);
      if (url.ok) {
        return { source: "workspace", serverUrl: url.url, adminToken: values.adminToken, maxInstances: parseMax(values.maxInstances) };
      }
      console.error("[integrações] Server URL da uazapi salva não é mais aceita; usando o ambiente");
    }
  }
  const env = uazapiFromEnv(opts.env ?? process.env);
  return env ? { source: "env", ...env } : null;
}

/** Gateway OpenWA do workspace (Canais) > OPENWA_* do ambiente > null. */
export async function resolveOpenwa(workspaceId: string | null | undefined, opts: ResolveOptions = {}): Promise<ResolvedOpenwa | null> {
  if (workspaceId) {
    const values = await workspaceValues(workspaceId, "openwa", opts);
    if (complete("openwa", values)) {
      const url = checkPublicHttpsUrl(values.baseUrl);
      if (url.ok) return { source: "workspace", baseUrl: url.url, apiKey: values.apiKey };
      console.error("[integrações] URL do gateway salva não é mais aceita; usando o ambiente");
    }
  }
  const env = opts.env ?? process.env;
  if (!env.OPENWA_BASE_URL || !env.OPENWA_API_KEY) return null;
  return { source: "env", baseUrl: env.OPENWA_BASE_URL, apiKey: env.OPENWA_API_KEY };
}

/** Configurado nas variáveis de ambiente? (só sim ou não, nunca o valor) */
export function envConfigured(service: IntegrationService, env: Env = process.env): boolean {
  if (service === "uazapi") return Boolean(uazapiFromEnv(env));
  return Boolean(env.OPENWA_BASE_URL && env.OPENWA_API_KEY);
}

/* ------------------------------------------------------------------------- */
/* Tela (dono/admin do workspace, pela sessão; as rotas conferem antes)      */
/* ------------------------------------------------------------------------- */

export type IntegrationFieldView = {
  field: string;
  kind: FieldKind;
  saved: boolean;
  /** 4 últimos caracteres (segredos e URLs). null quando não salvo. */
  last4: string | null;
  /** Só o número do plano (não é segredo). */
  number: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type IntegrationServiceView = {
  service: IntegrationService;
  fields: IntegrationFieldView[];
  /** O que vale agora pra este workspace. */
  source: CredentialSource | "none";
  /** Tem o conjunto completo salvo em Canais. */
  workspaceComplete: boolean;
  /** Tem o conjunto completo nas variáveis do servidor. */
  envConfigured: boolean;
};

type ManagerCtx = { userId: string; workspaceId: string };

const VIEW_SELECT = { service: true, field: true, last4: true, updatedAt: true, updatedById: true } as const;

/** Nome curto de quem trocou (nome ou e-mail). Lido fora da RLS: User não tem RLS. */
async function names(ids: string[], base: PrismaClient): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const users = await base.user
    .findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } })
    .catch(() => [] as Array<{ id: string; name: string | null; email: string | null }>);
  return new Map(users.map((u) => [u.id, u.name || u.email || "?"]));
}

export async function listIntegrationsForManager(
  ctx: ManagerCtx,
  opts: { app?: PrismaClient; system?: PrismaClient; env?: Env } = {}
): Promise<IntegrationServiceView[]> {
  const rows = await withRls(
    { userId: ctx.userId, workspaceId: ctx.workspaceId },
    (tx) => tx.workspaceIntegrationCredential.findMany({ where: { workspaceId: ctx.workspaceId }, select: VIEW_SELECT }),
    opts.app ?? getAppPrisma()
  );
  const who = await names([...new Set(rows.map((r) => r.updatedById))], opts.system ?? getPrisma());
  const env = opts.env ?? process.env;
  return INTEGRATION_SERVICES.map((service) => {
    const mine = rows.filter((r) => r.service === service);
    const fields = Object.entries(INTEGRATION_FIELDS[service]).map(([field, kind]): IntegrationFieldView => {
      const row = mine.find((r) => r.field === field);
      return {
        field,
        kind,
        saved: Boolean(row),
        last4: row && kind !== "number" ? row.last4 : null,
        number: row && kind === "number" ? Number.parseInt(row.last4, 10) || null : null,
        updatedAt: row ? row.updatedAt.toISOString() : null,
        updatedBy: row ? who.get(row.updatedById) ?? null : null,
      };
    });
    const workspaceComplete = REQUIRED[service].every((f) => mine.some((r) => r.field === f));
    const fromEnv = envConfigured(service, env);
    return {
      service,
      fields,
      workspaceComplete,
      envConfigured: fromEnv,
      source: workspaceComplete ? "workspace" : fromEnv ? "env" : "none",
    };
  });
}

export type SaveProblem = UrlProblem | "unknown_field" | "secret_invalid" | "number_invalid";

/** Confere e limpa o valor de um campo. Devolve o valor pronto pra cifrar. */
export async function validateFieldValue(
  service: IntegrationService,
  field: string,
  raw: unknown,
  lookup?: LookupAll
): Promise<{ ok: true; value: string } | { ok: false; code: SaveProblem }> {
  const kind = fieldKind(service, field);
  if (!kind) return { ok: false, code: "unknown_field" };
  if (kind === "url") {
    const check = await checkPublicUrlWithDns(raw, lookup);
    return check.ok ? { ok: true, value: check.url } : { ok: false, code: check.code };
  }
  if (kind === "number") {
    const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
    if (!/^\d{1,3}$/.test(text)) return { ok: false, code: "number_invalid" };
    const n = Number.parseInt(text, 10);
    return n >= 1 && n <= 100 ? { ok: true, value: String(n) } : { ok: false, code: "number_invalid" };
  }
  const text = typeof raw === "string" ? raw.trim() : "";
  // Token ou chave: 8 a 4096 caracteres visíveis, sem espaço no meio.
  if (text.length < 8 || text.length > 4096 || !/^[\x21-\x7e]+$/.test(text)) return { ok: false, code: "secret_invalid" };
  return { ok: true, value: text };
}

type Tx = Parameters<Parameters<typeof withRls>[1]>[0];

async function audit(tx: Tx, ctx: ManagerCtx, service: IntegrationService, field: string | null, action: "saved" | "replaced" | "removed" | "tested") {
  await tx.workspaceIntegrationAudit.create({
    data: { workspaceId: ctx.workspaceId, actorUserId: ctx.userId, service, field, action },
  });
}

export type SaveResult = { ok: true; replaced: boolean; last4: string } | { ok: false; code: SaveProblem };

/** Salvar ou trocar um campo. O valor entra e nunca volta (só os 4 últimos). */
export async function saveIntegrationField(
  ctx: ManagerCtx,
  input: { service: IntegrationService; field: string; value: unknown },
  opts: { app?: PrismaClient; lookup?: LookupAll } = {}
): Promise<SaveResult> {
  const checked = await validateFieldValue(input.service, input.field, input.value, opts.lookup);
  if (!checked.ok) return checked;
  const valueEnc = encryptToken(checked.value);
  const last4 = checked.value.slice(-4);
  const rls: RlsContext = { userId: ctx.userId, workspaceId: ctx.workspaceId };
  const replaced = await withRls(
    rls,
    async (tx) => {
      const where = { workspaceId_service_field: { workspaceId: ctx.workspaceId, service: input.service, field: input.field } };
      const existing = await tx.workspaceIntegrationCredential.findUnique({ where, select: { id: true } });
      await tx.workspaceIntegrationCredential.upsert({
        where,
        create: {
          workspaceId: ctx.workspaceId,
          service: input.service,
          field: input.field,
          valueEnc,
          last4,
          createdById: ctx.userId,
          updatedById: ctx.userId,
        },
        update: { valueEnc, last4, updatedById: ctx.userId },
        select: { id: true },
      });
      await audit(tx, ctx, input.service, input.field, existing ? "replaced" : "saved");
      return Boolean(existing);
    },
    opts.app ?? getAppPrisma()
  );
  invalidateIntegrationCache(ctx.workspaceId);
  return { ok: true, replaced, last4 };
}

/** Remover um campo. Sem o conjunto completo, volta a valer o ambiente. */
export async function removeIntegrationField(
  ctx: ManagerCtx,
  input: { service: IntegrationService; field: string },
  opts: { app?: PrismaClient } = {}
): Promise<{ removed: boolean }> {
  if (!fieldKind(input.service, input.field)) return { removed: false };
  const removed = await withRls(
    { userId: ctx.userId, workspaceId: ctx.workspaceId },
    async (tx) => {
      const { count } = await tx.workspaceIntegrationCredential.deleteMany({
        where: { workspaceId: ctx.workspaceId, service: input.service, field: input.field },
      });
      if (count > 0) await audit(tx, ctx, input.service, input.field, "removed");
      return count > 0;
    },
    opts.app ?? getAppPrisma()
  );
  invalidateIntegrationCache(ctx.workspaceId);
  return { removed };
}

/** Registra um "Testar conexão" (sem valor nenhum). Nunca derruba o teste. */
export async function auditIntegrationTest(ctx: ManagerCtx, service: IntegrationService, opts: { app?: PrismaClient } = {}): Promise<void> {
  await withRls({ userId: ctx.userId, workspaceId: ctx.workspaceId }, (tx) => audit(tx, ctx, service, null, "tested"), opts.app ?? getAppPrisma()).catch(
    () => undefined
  );
}

export type IntegrationAuditView = { service: string; field: string | null; action: string; actor: string | null; createdAt: string };

/** Últimas mudanças (sem valor), pra tela mostrar "quem mudou". */
export async function listIntegrationAudit(
  ctx: ManagerCtx,
  opts: { app?: PrismaClient; system?: PrismaClient; limit?: number } = {}
): Promise<IntegrationAuditView[]> {
  const rows = await withRls(
    { userId: ctx.userId, workspaceId: ctx.workspaceId },
    (tx) =>
      tx.workspaceIntegrationAudit.findMany({
        where: { workspaceId: ctx.workspaceId },
        orderBy: { createdAt: "desc" },
        take: Math.min(50, opts.limit ?? 10),
        select: { service: true, field: true, action: true, actorUserId: true, createdAt: true },
      }),
    opts.app ?? getAppPrisma()
  );
  const who = await names([...new Set(rows.map((r) => r.actorUserId))], opts.system ?? getPrisma());
  return rows.map((r) => ({
    service: r.service,
    field: r.field,
    action: r.action,
    actor: who.get(r.actorUserId) ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}
