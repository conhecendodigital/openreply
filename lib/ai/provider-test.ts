/**
 * Botão "Testar" do /admin > Chaves de IA: a chamada mais barata possível na
 * API oficial de cada provedor, só pra saber se a chave funciona.
 *
 * - Anthropic: POST /v1/messages com max_tokens 1 no Claude Haiku 4.5.
 * - OpenAI: GET /v1/models (não gasta token).
 * - TypeSafe (Jev): POST /v1/systemone com 1 pergunta sim/não e estado mínimo,
 *   o mesmo contrato do scripts/jev.py.
 *
 * URLs fixas: OPENAI_BASE_URL e afins do ambiente são ignorados de propósito
 * (no Mac do dono ele aponta pro Ollama). A resposta nunca traz a chave: o
 * texto de erro do provedor passa por redactSecrets antes de sair.
 */
import { MODEL_HAIKU, MODEL_JEV, type AiProvider } from "@/lib/ai/catalog";

export const OFFICIAL_TEST_URLS: Record<AiProvider, string> = {
  anthropic: "https://api.anthropic.com/v1/messages",
  openai: "https://api.openai.com/v1/models",
  typesafe: "https://api.typesafe.ai/v1/systemone",
};

/** Testes por admin: 10 a cada 10 minutos. */
export const AI_KEY_TEST_LIMIT = { limit: 10, windowSeconds: 10 * 60 };

export type KeyTestResult =
  | { ok: true; message: string }
  | { ok: false; status: number | null; message: string; detail: string | null };

/** Tira do texto a chave e qualquer coisa com cara de chave ou token. */
export function redactSecrets(text: string, key?: string): string {
  let out = text;
  if (key && key.length >= 4) out = out.split(key).join("[chave]");
  out = out
    .replace(/sk-[A-Za-z0-9_-]{4,}/g, "[chave]")
    .replace(/Bearer\s+\S+/gi, "Bearer [chave]")
    .replace(/[A-Za-z0-9_-]{24,}/g, "[...]");
  return out.slice(0, 200);
}

function requestFor(provider: AiProvider, key: string): RequestInit {
  if (provider === "anthropic") {
    return {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL_HAIKU, max_tokens: 1, messages: [{ role: "user", content: "oi" }] }),
    };
  }
  if (provider === "openai") {
    return { method: "GET", headers: { Authorization: `Bearer ${key}` } };
  }
  return {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      state: { t: "teste" },
      model: MODEL_JEV,
      questions: { ok: { type: "noul", instructions: "Is this a connection test?" } },
    }),
  };
}

async function providerMessage(res: Response): Promise<string | null> {
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown; detail?: unknown };
      const e = json.error;
      const m = typeof e === "string" ? e : e && typeof e === "object" ? e.message : json.message ?? json.detail;
      return typeof m === "string" ? m : null;
    } catch {
      return text ? text.slice(0, 300) : null;
    }
  } catch {
    return null;
  }
}

function messageForStatus(status: number, detail: string | null): string {
  if (status === 401) return "The provider refused this key. Check that you copied all of it.";
  if (status === 403) return "This key has no permission for this call.";
  if (status === 429) return "The provider says the limit or the balance ran out. Check your plan and credits.";
  if (status === 402 || (status === 400 && detail && /credit|balance|billing|saldo/i.test(detail))) {
    return "No balance on this account. Add credits at the provider.";
  }
  if (status === 404) return "The test model was not found for this key.";
  if (status >= 500) return "The provider is unstable right now. Try again in a few minutes.";
  return "The provider answered with an error.";
}

export async function testAiKey(
  provider: AiProvider,
  key: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<KeyTestResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  try {
    const res = await fetchImpl(OFFICIAL_TEST_URLS[provider], { ...requestFor(provider, key), signal: controller.signal });
    if (res.ok) return { ok: true, message: "The key works." };
    const raw = await providerMessage(res);
    const detail = raw ? redactSecrets(raw, key) : null;
    return { ok: false, status: res.status, message: messageForStatus(res.status, detail), detail };
  } catch (e) {
    const timeout = (e as Error)?.name === "AbortError";
    return {
      ok: false,
      status: null,
      message: timeout ? "The provider took too long to answer. Try again." : "Could not reach the provider.",
      detail: null,
    };
  } finally {
    clearTimeout(timer);
  }
}
