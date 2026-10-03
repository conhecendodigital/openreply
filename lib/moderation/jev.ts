/**
 * Optional second opinion from Jev (TypeSafe systemone API) for comments the
 * local rules found clean. Only runs when TYPESAFE_API_KEY is set and the
 * account turned it on. Any error or timeout counts as "ok" (never hide on a
 * failed call). The key is never logged.
 */
import type { ModerationCategory } from "@/lib/moderation/rules";

export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_TIMEOUT_MS = 8_000;

export function isJevAvailable(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY?.trim());
}

const CHOICE_TO_CATEGORY: Record<string, ModerationCategory | "ok"> = {
  ok: "ok",
  spam: "spam_link",
  golpe: "scam",
  politica: "politics",
  ofensa: "offense",
};

export type JevAnswer = {
  category: ModerationCategory | "ok";
  choice: string;
  confidence: number;
};

export async function askJev(
  commentText: string,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<JevAnswer | null> {
  const key = process.env.TYPESAFE_API_KEY?.trim();
  if (!key) return null;
  const doFetch = options.fetchImpl ?? fetch;

  try {
    const response = await doFetch(JEV_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        state: { comentario: commentText.slice(0, 1000) },
        model: "jev-latest",
        questions: {
          categoria: {
            type: "choice",
            instructions:
              "Comentário em post do Instagram de criador de conteúdo sobre IA. É lixo pra esconder?",
            criteria: {
              ok: "Comentário normal, pergunta, elogio, crítica educada, pedido do material ou palavra-chave",
              spam: "Spam, link, divulgação de outro perfil, seguir de volta",
              golpe: "Dinheiro fácil, pix, investimento milagroso, hacker, recuperar conta",
              politica: "Política partidária",
              ofensa: "Ofensa, xingamento, ódio",
            },
          },
        },
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? JEV_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      answers?: { categoria?: { choice?: string; confidence?: number } };
    };
    const choice = data.answers?.categoria?.choice;
    if (!choice) return null;
    const category = CHOICE_TO_CATEGORY[choice] ?? "ok";
    const confidence = Number(data.answers?.categoria?.confidence ?? 0);
    return { category, choice, confidence: Number.isFinite(confidence) ? confidence : 0 };
  } catch {
    return null;
  }
}
