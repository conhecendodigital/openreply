/**
 * Catálogo de IA da plataforma (06/10/2026): provedores, agentes, modelos que a
 * tela oferece, preços iniciais e a validação das configurações salvas no
 * /admin. Sem banco e sem segredo aqui: tudo puro, pra testar e pra usar na
 * tela e no servidor.
 */

export const AI_PROVIDERS = ["anthropic", "openai", "typesafe"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export function isAiProvider(value: unknown): value is AiProvider {
  return typeof value === "string" && (AI_PROVIDERS as readonly string[]).includes(value);
}

/** Os 3 agentes do WhatsApp (mesmos nomes de AGENTES em feat/wa-agentes). */
export const AI_AGENTS = ["qualificacao", "atendimento", "suporte"] as const;
export type AiAgent = (typeof AI_AGENTS)[number];

export function isAiAgent(value: unknown): value is AiAgent {
  return typeof value === "string" && (AI_AGENTS as readonly string[]).includes(value);
}

/** Quem gasta, no relatório (os 3 agentes, o cérebro, a triagem do Jev e a leitura de mídia do cliente). */
export const USAGE_AGENTS = [...AI_AGENTS, "cerebro", "triagem", "midia"] as const;
export type UsageAgent = (typeof USAGE_AGENTS)[number];

export function isUsageAgent(value: unknown): value is UsageAgent {
  return typeof value === "string" && (USAGE_AGENTS as readonly string[]).includes(value);
}

export const MODEL_HAIKU = "claude-haiku-4-5-20251001";
export const MODEL_SONNET = "claude-sonnet-5";
export const MODEL_GPT_MINI = "gpt-5-mini";
export const MODEL_EMBEDDING = "text-embedding-3-small";
export const MODEL_JEV = "jev-latest";

/** Preço em dólar por 1 milhão de tokens. */
export type ModelPrice = {
  provider: AiProvider;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

/**
 * Preços iniciais (06/10/2026). Mudam com o tempo: o dono edita no /admin e o
 * custo de cada chamada é gravado com o preço daquele momento.
 * Cache: leitura = 10% da entrada; escrita na Anthropic = 125%.
 */
export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  [MODEL_HAIKU]: { provider: "anthropic", input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  [MODEL_SONNET]: { provider: "anthropic", input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  [MODEL_GPT_MINI]: { provider: "openai", input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 },
  [MODEL_EMBEDDING]: { provider: "openai", input: 0.02, output: 0, cacheRead: 0, cacheWrite: 0 },
  // scripts/jev.py: US$ 0,042 por milhão de tokens.
  [MODEL_JEV]: { provider: "typesafe", input: 0.042, output: 0, cacheRead: 0, cacheWrite: 0 },
};

/** Modelos de conversa que cada agente pode usar (os selects da tela). */
export const CHAT_MODELS: Record<"anthropic" | "openai", string[]> = {
  anthropic: [MODEL_HAIKU, MODEL_SONNET],
  openai: [MODEL_GPT_MINI],
};

export type AgentModelConfig = {
  provider: "anthropic" | "openai";
  /** Modelo do dia a dia. */
  model: string;
  /** Modelo do caso difícil (Jev incerto ou conversa difícil). */
  hardModel: string;
};

export const DEFAULT_AGENT_MODEL: AgentModelConfig = {
  provider: "anthropic",
  model: MODEL_HAIKU,
  hardModel: MODEL_SONNET,
};

export function defaultModelsFor(provider: "anthropic" | "openai"): AgentModelConfig {
  return provider === "anthropic"
    ? { provider, model: MODEL_HAIKU, hardModel: MODEL_SONNET }
    : { provider, model: MODEL_GPT_MINI, hardModel: MODEL_GPT_MINI };
}

export const DEFAULT_DAILY_CAP_USER_USD = 1;
export const DEFAULT_DAILY_CAP_WORKSPACE_USD = 3;
/** Aviso no /admin e no painel quando o gasto do dia passa disso do teto. */
export const CAP_ALERT_RATIO = 0.8;

export type AiSettings = {
  agents: Record<AiAgent, AgentModelConfig>;
  dailyCapUserUsd: number;
  dailyCapWorkspaceUsd: number;
  prices: Record<string, ModelPrice>;
  /** Cotação pra mostrar em R$. null = só dólar. */
  usdToBrl: number | null;
};

export function defaultSettings(): AiSettings {
  return {
    agents: {
      qualificacao: { ...DEFAULT_AGENT_MODEL },
      atendimento: { ...DEFAULT_AGENT_MODEL },
      suporte: { ...DEFAULT_AGENT_MODEL },
    },
    dailyCapUserUsd: DEFAULT_DAILY_CAP_USER_USD,
    dailyCapWorkspaceUsd: DEFAULT_DAILY_CAP_WORKSPACE_USD,
    prices: clonePrices(DEFAULT_PRICES),
    usdToBrl: null,
  };
}

function clonePrices(prices: Record<string, ModelPrice>): Record<string, ModelPrice> {
  return Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, { ...v }]));
}

const MODEL_NAME = /^[a-z0-9][a-z0-9._:-]{1,79}$/i;

function money(value: unknown, max: number): number | null {
  const n = typeof value === "string" ? Number.parseFloat(value.replace(",", ".")) : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return Math.round(n * 1_000_000) / 1_000_000;
}

/** Tabela de preços vinda do banco ou da tela. Linha inválida é ignorada. */
export function normalizePrices(raw: unknown): Record<string, ModelPrice> {
  const out: Record<string, ModelPrice> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [model, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!MODEL_NAME.test(model) || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    if (!isAiProvider(v.provider)) continue;
    const input = money(v.input, 1000);
    const output = money(v.output ?? 0, 1000);
    const cacheRead = money(v.cacheRead ?? 0, 1000);
    const cacheWrite = money(v.cacheWrite ?? 0, 1000);
    if (input === null || output === null || cacheRead === null || cacheWrite === null) continue;
    out[model] = { provider: v.provider, input, output, cacheRead, cacheWrite };
    if (Object.keys(out).length >= 50) break;
  }
  return out;
}

function normalizeAgent(raw: unknown, prices: Record<string, ModelPrice>): AgentModelConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_AGENT_MODEL };
  const v = raw as Record<string, unknown>;
  const provider = v.provider === "openai" ? "openai" : v.provider === "anthropic" ? "anthropic" : null;
  if (!provider) return { ...DEFAULT_AGENT_MODEL };
  const defaults = defaultModelsFor(provider);
  // Só modelo com preço conhecido e do mesmo provedor: sem preço, o teto não funciona.
  const ok = (m: unknown) => typeof m === "string" && prices[m]?.provider === provider;
  return {
    provider,
    model: ok(v.model) ? (v.model as string) : defaults.model,
    hardModel: ok(v.hardModel) ? (v.hardModel as string) : defaults.hardModel,
  };
}

/** Linha de PlatformAiSettings (ou nada) -> configurações completas e válidas. */
export function normalizeSettings(
  row:
    | {
        agentModels?: unknown;
        prices?: unknown;
        dailyCapUserUsd?: unknown;
        dailyCapWorkspaceUsd?: unknown;
        usdToBrl?: unknown;
      }
    | null
    | undefined
): AiSettings {
  const base = defaultSettings();
  if (!row) return base;
  const saved = normalizePrices(row.prices);
  const prices = Object.keys(saved).length ? saved : base.prices;
  const agentsRaw = (row.agentModels && typeof row.agentModels === "object" ? row.agentModels : {}) as Record<string, unknown>;
  const agents = Object.fromEntries(AI_AGENTS.map((a) => [a, normalizeAgent(agentsRaw[a], prices)])) as Record<
    AiAgent,
    AgentModelConfig
  >;
  const capUser = money(row.dailyCapUserUsd, 10_000);
  const capWs = money(row.dailyCapWorkspaceUsd, 100_000);
  const rate = row.usdToBrl === null || row.usdToBrl === undefined || row.usdToBrl === "" ? null : money(row.usdToBrl, 100);
  return {
    agents,
    prices,
    dailyCapUserUsd: capUser ?? base.dailyCapUserUsd,
    dailyCapWorkspaceUsd: capWs ?? base.dailyCapWorkspaceUsd,
    usdToBrl: rate && rate > 0 ? rate : null,
  };
}

export type SettingsInputError = { field: string; message: string };

/**
 * O que a tela mandou -> configurações a gravar, ou o primeiro erro (em
 * inglês: a tela traduz). Diferente de normalizeSettings, aqui nada é
 * ignorado em silêncio.
 */
export function parseSettingsInput(
  input: unknown,
  current: AiSettings
): { ok: true; settings: AiSettings } | { ok: false; error: SettingsInputError } {
  if (!input || typeof input !== "object") return { ok: false, error: { field: "body", message: "Invalid data." } };
  const v = input as Record<string, unknown>;
  const next: AiSettings = { ...current, agents: { ...current.agents }, prices: clonePrices(current.prices) };

  if (v.prices !== undefined) {
    if (!v.prices || typeof v.prices !== "object" || Array.isArray(v.prices)) {
      return { ok: false, error: { field: "prices", message: "Invalid price table." } };
    }
    const entries = Object.entries(v.prices as Record<string, unknown>);
    const prices = normalizePrices(v.prices);
    if (entries.length === 0 || Object.keys(prices).length !== entries.length) {
      return { ok: false, error: { field: "prices", message: "Every price must be a number from 0 to 1000 dollars per million tokens." } };
    }
    next.prices = prices;
  }

  if (v.agents !== undefined) {
    if (!v.agents || typeof v.agents !== "object") return { ok: false, error: { field: "agents", message: "Invalid data." } };
    const agentsIn = v.agents as Record<string, unknown>;
    for (const agent of AI_AGENTS) {
      const a = agentsIn[agent];
      if (a === undefined) continue;
      const cfg = a as Record<string, unknown>;
      const provider = cfg?.provider;
      if (provider !== "anthropic" && provider !== "openai") {
        return { ok: false, error: { field: `agents.${agent}`, message: "Choose Claude (Anthropic) or OpenAI." } };
      }
      for (const key of ["model", "hardModel"] as const) {
        const m = cfg[key];
        if (typeof m !== "string" || next.prices[m]?.provider !== provider) {
          return { ok: false, error: { field: `agents.${agent}.${key}`, message: "This model has no price in the table for this provider." } };
        }
      }
      next.agents[agent] = { provider, model: cfg.model as string, hardModel: cfg.hardModel as string };
    }
  }
  // Modelo que saiu da tabela de preços volta pro padrão do provedor.
  for (const agent of AI_AGENTS) next.agents[agent] = normalizeAgent(next.agents[agent], next.prices);

  if (v.dailyCapUserUsd !== undefined) {
    const n = money(v.dailyCapUserUsd, 10_000);
    if (n === null) return { ok: false, error: { field: "dailyCapUserUsd", message: "The daily cap must be a number from 0 to 10000 dollars." } };
    next.dailyCapUserUsd = n;
  }
  if (v.dailyCapWorkspaceUsd !== undefined) {
    const n = money(v.dailyCapWorkspaceUsd, 100_000);
    if (n === null) return { ok: false, error: { field: "dailyCapWorkspaceUsd", message: "The daily cap must be a number from 0 to 100000 dollars." } };
    next.dailyCapWorkspaceUsd = n;
  }
  if (v.usdToBrl !== undefined) {
    if (v.usdToBrl === null || v.usdToBrl === "") next.usdToBrl = null;
    else {
      const n = money(v.usdToBrl, 100);
      if (n === null || n <= 0) return { ok: false, error: { field: "usdToBrl", message: "The exchange rate must be a number above 0." } };
      next.usdToBrl = n;
    }
  }
  return { ok: true, settings: next };
}

/** Formato da chave por provedor (só o básico; quem confirma é o botão Testar). */
export function validateKeyFormat(provider: AiProvider, key: string): boolean {
  if (key.length < 20 || key.length > 400 || /\s/.test(key)) return false;
  if (provider === "anthropic") return key.startsWith("sk-ant-");
  if (provider === "openai") return key.startsWith("sk-") && !key.startsWith("sk-ant-");
  return /^[\x21-\x7e]+$/.test(key);
}

export function keyFormatHint(provider: AiProvider): string {
  if (provider === "anthropic") return "This key does not look like an Anthropic key. It starts with sk-ant-.";
  if (provider === "openai") return "This key does not look like an OpenAI key. It starts with sk-.";
  return "This key does not look right. Paste it again, without spaces.";
}
