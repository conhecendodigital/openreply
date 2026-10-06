/**
 * Regra das 24h e ritmo humano. Funções puras (o sorteio e o relógio entram
 * por parâmetro), então os testes conseguem medir tempo e quebra.
 */
import { hitRateLimit } from "@/lib/http-rate-limit";

/** Só responde se a última mensagem do contato tiver menos de 24h. Vale pros dois conectores. */
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinReplyWindow(lastInboundAt: Date | null, now: number): boolean {
  if (!lastInboundAt) return false;
  const age = now - lastInboundAt.getTime();
  // Relógio do celular um pouco adiantado não pode abrir janela infinita.
  return age < REPLY_WINDOW_MS && age > -5 * 60 * 1000;
}

export interface PacingConfig {
  /** Tamanho máximo de uma bolha. Acima disso quebra em frases. */
  maxBubbleChars: number;
  /** Máximo de bolhas por resposta. O que sobrar vai junto na última (nada some). */
  maxBubbles: number;
  /** "Lendo" antes de começar a digitar a primeira bolha. */
  readDelayMs: [number, number];
  /** ms de "digitando..." por caractere. ~60 ms = 16 caracteres por segundo. */
  typingMsPerChar: number;
  typingMinMs: number;
  typingMaxMs: number;
  /** Variação aleatória do tempo de digitação (0.8 = até 20% menos, 1.25 = até 25% mais). */
  jitter: [number, number];
  /** Pausa entre uma bolha e o "digitando..." da próxima. */
  gapMs: [number, number];
  /** Mensagens por minuto por número. */
  perMinutePerNumber: number;
}

export const DEFAULT_PACING: PacingConfig = {
  maxBubbleChars: 220,
  maxBubbles: 5,
  readDelayMs: [1500, 4000],
  typingMsPerChar: 60,
  typingMinMs: 1200,
  typingMaxMs: 9000,
  jitter: [0.8, 1.25],
  gapMs: [400, 1200],
  perMinutePerNumber: 12,
};

export type Rand = () => number;

function between([min, max]: [number, number], rand: Rand): number {
  return Math.round(min + (max - min) * rand());
}

/** Quebra frases sem perder pontuação. "Oi! Tudo bem? Sim." → ["Oi!", "Tudo bem?", "Sim."] */
function sentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+(?:[.!?…]+|$)\s*/g);
  return (parts ?? [text]).map((s) => s.trim()).filter(Boolean);
}

/** Último recurso pra frase gigante sem pontuação: corta em espaço. */
function hardWrap(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Quebra a resposta em mensagens curtas, como gente digita no WhatsApp:
 * cada parágrafo vira uma bolha; parágrafo longo quebra por frase, juntando
 * frases curtas até o limite. Nunca muda nem descarta texto.
 */
export function splitIntoBubbles(text: string, config: Pick<PacingConfig, "maxBubbleChars" | "maxBubbles"> = DEFAULT_PACING): string[] {
  const max = config.maxBubbleChars;
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const bubbles: string[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= max) {
      bubbles.push(paragraph);
      continue;
    }
    let current = "";
    for (const sentence of sentences(paragraph)) {
      const pieces = sentence.length > max ? hardWrap(sentence, max) : [sentence];
      for (const piece of pieces) {
        if (!current) current = piece;
        else if (current.length + 1 + piece.length <= max) current = `${current} ${piece}`;
        else {
          bubbles.push(current);
          current = piece;
        }
      }
    }
    if (current) bubbles.push(current);
  }
  if (bubbles.length > config.maxBubbles) {
    const head = bubbles.slice(0, config.maxBubbles - 1);
    head.push(bubbles.slice(config.maxBubbles - 1).join("\n\n"));
    return head;
  }
  return bubbles;
}

/** Tempo de "digitando..." proporcional ao tamanho da bolha, com variação. */
export function typingDelayMs(text: string, rand: Rand, config: PacingConfig = DEFAULT_PACING): number {
  const factor = config.jitter[0] + (config.jitter[1] - config.jitter[0]) * rand();
  const raw = text.length * config.typingMsPerChar * factor;
  return Math.round(Math.min(config.typingMaxMs, Math.max(config.typingMinMs, raw)));
}

export interface BubblePlan {
  text: string;
  /** Espera antes de ligar o "digitando..." (leitura na primeira, pausa entre bolhas nas outras). */
  waitBeforeTypingMs: number;
  /** Quanto tempo fica "digitando..." antes de mandar. */
  typingMs: number;
}

export function planBubbles(text: string, rand: Rand, config: PacingConfig = DEFAULT_PACING): BubblePlan[] {
  return splitIntoBubbles(text, config).map((bubble, i) => ({
    text: bubble,
    waitBeforeTypingMs: i === 0 ? between(config.readDelayMs, rand) : between(config.gapMs, rand),
    typingMs: typingDelayMs(bubble, rand, config),
  }));
}

// ─── Limite por minuto por número ────────────────────────────────────────────

export interface SendRateLimiter {
  /** Conta 1 envio do número. Se passou do limite, diz quanto esperar. */
  acquire(sessionId: string, now: number): Promise<{ allowed: boolean; retryAfterMs: number }>;
}

/** Janela fixa de 1 minuto (testes e processo único). */
export class InMemorySendRateLimiter implements SendRateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  constructor(private readonly perMinute: number = DEFAULT_PACING.perMinutePerNumber) {}

  async acquire(sessionId: string, now: number) {
    const start = Math.floor(now / 60_000) * 60_000;
    const w = this.windows.get(sessionId);
    if (!w || w.start !== start) {
      this.windows.set(sessionId, { start, count: 1 });
      return { allowed: true, retryAfterMs: 0 };
    }
    if (w.count >= this.perMinute) return { allowed: false, retryAfterMs: start + 60_000 - now };
    w.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }
}

/** Mesmo Redis do BullMQ (lib/http-rate-limit). Se o Redis cair, deixa passar. */
export class RedisSendRateLimiter implements SendRateLimiter {
  constructor(private readonly perMinute: number = DEFAULT_PACING.perMinutePerNumber) {}

  async acquire(sessionId: string, now: number) {
    const minute = Math.floor(now / 60_000);
    const check = await hitRateLimit("wa-send", `${sessionId}:${minute}`, this.perMinute, 120);
    return { allowed: check.allowed, retryAfterMs: check.allowed ? 0 : (minute + 1) * 60_000 - now };
  }
}
