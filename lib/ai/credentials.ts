/**
 * Chaves de IA da plataforma e modelo de cada agente (06/10/2026, pedido do
 * dono: "as API quero colocar a chave no admin"). Só no servidor.
 *
 * O admin cadastra em /admin > Chaves de IA uma chave por provedor
 * (anthropic, openai, typesafe). Ela vale pra todos os usuários do beta.
 *
 * - Guardada com AES-256-GCM (encryptToken de lib/meta/oauth.ts, mesma
 *   ENCRYPTION_KEY dos tokens da Meta). Só os 4 últimos caracteres saem.
 * - A chave aberta NUNCA vai pra resposta de API, log, erro, página ou MCP.
 *   Quem abre é só getAiCredential (agentes) e keyForTest (botão Testar).
 * - Banco: RLS deixa só o admin ler e gravar (papel le_app + app.is_admin()).
 *   Os agentes leem pelo papel de sistema (le_system), sem sessão.
 * - Cada salvar, trocar e remover vira uma linha em AdminAccessLog.
 *
 * Como os agentes do branch feat/wa-agentes trocam o que tinham:
 *
 *   // antes: chave do dono (AiCredential + abrirChave) e process.env.TYPESAFE_API_KEY
 *   const cred = await getAiCredential("anthropic");      // { apiKey, keyLast4 } ou null
 *   const jev = await getAiCredential("typesafe");
 *   perguntarJev(estado, perguntas, { apiKey: jev?.apiKey ?? "" });
 *
 *   // antes: WaAgentConfig.provider/modelo/modeloDificil e WA_TETO_DIARIO_*_USD
 *   const cfg = await getAgentModelConfig("atendimento");
 *   // { provider, model, hardModel, dailyCapUserUsd, dailyCapWorkspaceUsd }
 *
 * Detalhes em docs/ia-chaves-e-gastos.md.
 */
import type { PrismaClient } from "@/app/generated/prisma/client";
import { getPrisma } from "@/lib/db/client";
import { getAppPrisma, withRls, withSystemRole } from "@/lib/db/rls";
import { decryptToken, encryptToken } from "@/lib/meta/oauth";
import {
  AI_PROVIDERS,
  keyFormatHint,
  normalizeSettings,
  parseSettingsInput,
  validateKeyFormat,
  type AgentModelConfig,
  type AiAgent,
  type AiProvider,
  type AiSettings,
} from "@/lib/ai/catalog";

/** AdminAccessLog pede um workspace: as chaves são da plataforma. */
export const PLATFORM_AUDIT_WORKSPACE = "platform";
const SETTINGS_ID = "global";

export type AiCredentialSecret = { provider: AiProvider; apiKey: string; keyLast4: string };

/** O que a tela e a API podem ver de uma chave. Nunca a chave. */
export type PublicAiCredential = {
  provider: AiProvider;
  keyLast4: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  updatedById: string;
};

/** Lista explícita de campos: coluna nova não vaza por engano, e keyEnc nunca sai. */
const PUBLIC_SELECT = {
  provider: true,
  keyLast4: true,
  active: true,
  createdAt: true,
  updatedAt: true,
  updatedById: true,
} as const;

function asProvider(value: string): AiProvider {
  return value as AiProvider;
}

/* ------------------------------------------------------------------------- */
/* Agentes (servidor, sem sessão)                                            */
/* ------------------------------------------------------------------------- */

/**
 * Chave aberta do provedor, pra chamar a API oficial. null quando não há chave
 * ativa (ou ela não abre com a ENCRYPTION_KEY de agora).
 * Só no servidor. Nunca devolver isso numa rota, log ou mensagem de erro.
 */
export async function getAiCredential(
  provider: AiProvider,
  base: PrismaClient = getPrisma()
): Promise<AiCredentialSecret | null> {
  if (!AI_PROVIDERS.includes(provider)) return null;
  const row = await withSystemRole(
    (tx) =>
      tx.platformAiCredential.findUnique({
        where: { provider },
        select: { provider: true, keyEnc: true, keyLast4: true, active: true },
      }),
    base
  );
  if (!row || !row.active) return null;
  try {
    return { provider: asProvider(row.provider), apiKey: decryptToken(row.keyEnc), keyLast4: row.keyLast4 };
  } catch {
    // ENCRYPTION_KEY trocada: a chave salva não abre. Sem detalhe no log.
    console.error(`[ai] a chave de ${provider} não abriu (ENCRYPTION_KEY mudou?)`);
    return null;
  }
}

/** Configurações completas (padrões quando o admin ainda não salvou nada). */
export async function getAiSettings(base: PrismaClient = getPrisma()): Promise<AiSettings> {
  const row = await withSystemRole((tx) => tx.platformAiSettings.findUnique({ where: { id: SETTINGS_ID } }), base);
  return normalizeSettings(row);
}

export type AgentRuntimeConfig = AgentModelConfig & {
  agent: AiAgent;
  dailyCapUserUsd: number;
  dailyCapWorkspaceUsd: number;
};

/** Provedor e modelos do agente, mais os tetos diários (padrões: Haiku 4.5, Sonnet 5, US$ 1 e US$ 3). */
export async function getAgentModelConfig(agent: AiAgent, base: PrismaClient = getPrisma()): Promise<AgentRuntimeConfig> {
  const settings = await getAiSettings(base);
  return {
    agent,
    ...settings.agents[agent],
    dailyCapUserUsd: settings.dailyCapUserUsd,
    dailyCapWorkspaceUsd: settings.dailyCapWorkspaceUsd,
  };
}

/* ------------------------------------------------------------------------- */
/* Admin (/admin, sessão do admin com 2FA; as rotas conferem antes)          */
/* ------------------------------------------------------------------------- */

type AuditTx = Parameters<Parameters<typeof withRls>[1]>[0];

async function audit(tx: AuditTx, adminUserId: string, resource: string, resourceId: string | null, reason: string) {
  await tx.adminAccessLog.create({
    data: { adminUserId, targetWorkspaceId: PLATFORM_AUDIT_WORKSPACE, resource, resourceId, reason },
  });
}

export async function listAiCredentialsForAdmin(
  adminUserId: string,
  base: PrismaClient = getAppPrisma()
): Promise<PublicAiCredential[]> {
  const rows = await withRls(
    { userId: adminUserId, workspaceId: null },
    (tx) => tx.platformAiCredential.findMany({ select: PUBLIC_SELECT, orderBy: { provider: "asc" } }),
    base
  );
  return rows.map((r) => ({ ...r, provider: asProvider(r.provider) }));
}

export type SaveKeyResult =
  | { ok: true; credential: PublicAiCredential; replaced: boolean }
  | { ok: false; error: string };

export async function saveAiCredential(
  input: { adminUserId: string; provider: AiProvider; key: unknown },
  base: PrismaClient = getAppPrisma()
): Promise<SaveKeyResult> {
  if (!AI_PROVIDERS.includes(input.provider)) return { ok: false, error: "Unknown provider." };
  const key = typeof input.key === "string" ? input.key.trim() : "";
  if (!validateKeyFormat(input.provider, key)) return { ok: false, error: keyFormatHint(input.provider) };
  const keyEnc = encryptToken(key);
  const keyLast4 = key.slice(-4);
  return withRls(
    { userId: input.adminUserId, workspaceId: null },
    async (tx) => {
      const existing = await tx.platformAiCredential.findUnique({ where: { provider: input.provider }, select: { id: true } });
      const row = await tx.platformAiCredential.upsert({
        where: { provider: input.provider },
        create: {
          provider: input.provider,
          keyEnc,
          keyLast4,
          active: true,
          createdById: input.adminUserId,
          updatedById: input.adminUserId,
        },
        update: { keyEnc, keyLast4, active: true, updatedById: input.adminUserId },
        select: PUBLIC_SELECT,
      });
      await audit(tx, input.adminUserId, "ai.credential", input.provider, existing ? "trocou a chave" : "salvou a chave");
      return { ok: true as const, credential: { ...row, provider: asProvider(row.provider) }, replaced: Boolean(existing) };
    },
    base
  );
}

export async function removeAiCredential(
  input: { adminUserId: string; provider: AiProvider },
  base: PrismaClient = getAppPrisma()
): Promise<{ removed: boolean }> {
  if (!AI_PROVIDERS.includes(input.provider)) return { removed: false };
  return withRls(
    { userId: input.adminUserId, workspaceId: null },
    async (tx) => {
      const { count } = await tx.platformAiCredential.deleteMany({ where: { provider: input.provider } });
      if (count > 0) await audit(tx, input.adminUserId, "ai.credential", input.provider, "removeu a chave");
      return { removed: count > 0 };
    },
    base
  );
}

/** Chave salva aberta, só pro botão Testar do admin (nunca vai pra resposta). */
export async function keyForTest(
  adminUserId: string,
  provider: AiProvider,
  base: PrismaClient = getAppPrisma()
): Promise<string | null> {
  const row = await withRls(
    { userId: adminUserId, workspaceId: null },
    (tx) => tx.platformAiCredential.findUnique({ where: { provider }, select: { keyEnc: true } }),
    base
  );
  if (!row) return null;
  try {
    return decryptToken(row.keyEnc);
  } catch {
    return null;
  }
}

export async function getAiSettingsForAdmin(adminUserId: string, base: PrismaClient = getAppPrisma()): Promise<AiSettings> {
  const row = await withRls(
    { userId: adminUserId, workspaceId: null },
    (tx) => tx.platformAiSettings.findUnique({ where: { id: SETTINGS_ID } }),
    base
  );
  return normalizeSettings(row);
}

export async function saveAiSettings(
  input: { adminUserId: string; data: unknown },
  base: PrismaClient = getAppPrisma()
): Promise<{ ok: true; settings: AiSettings } | { ok: false; error: string; field: string }> {
  return withRls(
    { userId: input.adminUserId, workspaceId: null },
    async (tx) => {
      const current = normalizeSettings(await tx.platformAiSettings.findUnique({ where: { id: SETTINGS_ID } }));
      const parsed = parseSettingsInput(input.data, current);
      if (!parsed.ok) return { ok: false as const, error: parsed.error.message, field: parsed.error.field };
      const s = parsed.settings;
      const data = {
        agentModels: s.agents,
        prices: s.prices,
        dailyCapUserUsd: s.dailyCapUserUsd,
        dailyCapWorkspaceUsd: s.dailyCapWorkspaceUsd,
        usdToBrl: s.usdToBrl,
        updatedById: input.adminUserId,
      };
      await tx.platformAiSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, ...data }, update: data });
      await audit(tx, input.adminUserId, "ai.settings", SETTINGS_ID, "mudou modelos, tetos ou preços de IA");
      return { ok: true as const, settings: s };
    },
    base
  );
}
