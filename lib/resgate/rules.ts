/**
 * Resgatar comentários (28/10/2026): regras PURAS (sem banco, sem Meta), pra
 * testar sozinhas. Quem lê o Instagram e o banco é lib/resgate/service.ts.
 *
 * Resposta privada a comentário (Instagram Private Replies): vale por 7 DIAS
 * depois do comentário e UMA vez por comentário (documentação da Meta).
 */
import { foldDiacritics, matchKeywords, stripSpecialCharacters } from "@/lib/utils/keyword-matcher";

export const PRIVATE_REPLY_WINDOW_MS = 7 * 24 * 3_600_000;
/** Margem: não tentar comentário que vence nos próximos minutos (o envio demora). */
export const WINDOW_SAFETY_MS = 10 * 60_000;

export type RawComment = {
  id: string;
  text?: string | null;
  timestamp?: string | null;
  from?: { id: string; username?: string } | null;
  parent_id?: string | null;
};

export type Candidate = {
  commentId: string;
  igUserId: string;
  username: string | null;
  text: string;
  commentAt: Date;
  /** palavra | grafia | extra | qualquer */
  matchedBy: "palavra" | "grafia" | "extra" | "qualquer";
};

export type TriggerRule = {
  matchAnyWord: boolean;
  keywords: string[];
  wholeWordMatch: boolean;
  /** Variações que o dono mandou (ex.: "gmani", "geminni"). */
  extraWords?: string[];
  /** Aceita erro de digitação de 1 ou 2 letras na palavra-chave. */
  tolerateTypos?: boolean;
};

export type ClassifyInput = {
  comments: RawComment[];
  ownIgUserIds: string[];
  now: Date;
  /** Só comentários a partir daqui (opcional). */
  since?: Date | null;
  trigger: TriggerRule;
  /** Comentários que já tiveram a resposta privada (qualquer fluxo/campanha). */
  servedCommentIds: Set<string>;
  /** Pessoas que já receberam DM deste fluxo/campanha. */
  servedPersonIds: Set<string>;
  optOutPersonIds: Set<string>;
  takeoverPersonIds: Set<string>;
  moderatedCommentIds: Set<string>;
  /** Pessoas já planejadas em outra execução ainda aberta deste alvo. */
  pendingElsewhere?: Set<string>;
};

export type ClassifyCounts = {
  lidos: number;
  proprios: number;
  respostasADecomentario: number;
  semAutor: number;
  semData: number;
  antesDoDesde: number;
  vencidos: number;
  jaAtendidosPorComentario: number;
  jaAtendidosPorPessoa: number;
  optOut: number;
  assumidosPorHumano: number;
  moderados: number;
  naoCasamComOGatilho: number;
  pessoaRepetida: number;
  elegiveis: number;
  elegiveisPorGrafia: number;
};

export function emptyCounts(): ClassifyCounts {
  return {
    lidos: 0,
    proprios: 0,
    respostasADecomentario: 0,
    semAutor: 0,
    semData: 0,
    antesDoDesde: 0,
    vencidos: 0,
    jaAtendidosPorComentario: 0,
    jaAtendidosPorPessoa: 0,
    optOut: 0,
    assumidosPorHumano: 0,
    moderados: 0,
    naoCasamComOGatilho: 0,
    pessoaRepetida: 0,
    elegiveis: 0,
    elegiveisPorGrafia: 0,
  };
}

function norm(text: string): string {
  return foldDiacritics(stripSpecialCharacters(text)).toLowerCase();
}

/** Distância de edição (Levenshtein) com corte: devolve > max quando passa. */
export function editDistance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Alguma palavra do comentário é a palavra-chave com 1-2 letras trocadas (palavras de 4+ letras)? */
export function sameWordWithTypo(commentText: string, keywords: string[]): boolean {
  const words = norm(commentText).split(/\s+/).filter(Boolean);
  for (const kw of keywords) {
    const k = norm(kw);
    if (!k || k.includes(" ") || k.length < 4) continue;
    const limit = k.length <= 5 ? 1 : 2;
    for (const w of words) {
      if (w.length < 3) continue;
      if (w !== k && editDistance(w, k, limit) <= limit) return true;
    }
  }
  return false;
}

/** Como o gatilho do fluxo/campanha vê o comentário (mesma função do webhook) + extras do dono. */
export function matchesTrigger(text: string, trigger: TriggerRule): Candidate["matchedBy"] | null {
  if (trigger.matchAnyWord) return "qualquer";
  if (matchKeywords(text, trigger.keywords, trigger.wholeWordMatch).matched) return "palavra";
  if (trigger.extraWords?.length && matchKeywords(text, trigger.extraWords, trigger.wholeWordMatch).matched) return "extra";
  if (trigger.tolerateTypos && sameWordWithTypo(text, [...trigger.keywords, ...(trigger.extraWords ?? [])])) return "grafia";
  return null;
}

export function classifyComments(input: ClassifyInput): { candidates: Candidate[]; counts: ClassifyCounts } {
  const counts = emptyCounts();
  const own = new Set(input.ownIgUserIds);
  const nowMs = input.now.getTime();
  const sinceMs = input.since ? input.since.getTime() : null;
  const byPerson = new Map<string, Candidate>();

  for (const c of input.comments) {
    counts.lidos += 1;
    const authorId = c.from?.id;
    if (!authorId) {
      counts.semAutor += 1;
      continue;
    }
    if (own.has(authorId)) {
      counts.proprios += 1;
      continue;
    }
    if (c.parent_id) {
      // Resposta a outro comentário: a resposta privada é do comentário de
      // topo; responder aqui seria falar com quem só conversou com outra pessoa.
      counts.respostasADecomentario += 1;
      continue;
    }
    const at = c.timestamp ? Date.parse(c.timestamp) : Number.NaN;
    if (!Number.isFinite(at)) {
      counts.semData += 1;
      continue;
    }
    if (sinceMs !== null && at < sinceMs) {
      counts.antesDoDesde += 1;
      continue;
    }
    if (nowMs - at > PRIVATE_REPLY_WINDOW_MS - WINDOW_SAFETY_MS) {
      counts.vencidos += 1;
      continue;
    }
    if (input.servedCommentIds.has(c.id)) {
      counts.jaAtendidosPorComentario += 1;
      continue;
    }
    if (input.servedPersonIds.has(authorId) || input.pendingElsewhere?.has(authorId)) {
      counts.jaAtendidosPorPessoa += 1;
      continue;
    }
    if (input.optOutPersonIds.has(authorId)) {
      counts.optOut += 1;
      continue;
    }
    if (input.takeoverPersonIds.has(authorId)) {
      counts.assumidosPorHumano += 1;
      continue;
    }
    if (input.moderatedCommentIds.has(c.id)) {
      counts.moderados += 1;
      continue;
    }
    const matchedBy = matchesTrigger(c.text ?? "", input.trigger);
    if (!matchedBy) {
      counts.naoCasamComOGatilho += 1;
      continue;
    }
    const candidate: Candidate = {
      commentId: c.id,
      igUserId: authorId,
      username: c.from?.username ?? null,
      text: (c.text ?? "").slice(0, 1000),
      commentAt: new Date(at),
      matchedBy,
    };
    // 1 DM por pessoa por fluxo: fica o comentário que casa melhor (palavra
    // exata antes de grafia) e, empatando, o MAIS NOVO (mais prazo pela frente).
    const rank = (m: Candidate["matchedBy"]) => (m === "grafia" ? 0 : 1);
    const prev = byPerson.get(authorId);
    if (prev) {
      counts.pessoaRepetida += 1;
      const better =
        rank(candidate.matchedBy) > rank(prev.matchedBy) ||
        (rank(candidate.matchedBy) === rank(prev.matchedBy) && candidate.commentAt > prev.commentAt);
      if (better) byPerson.set(authorId, candidate);
    } else {
      byPerson.set(authorId, candidate);
    }
  }

  // Mais antigo primeiro: quem vence antes é atendido antes.
  const candidates = [...byPerson.values()].sort((a, b) => a.commentAt.getTime() - b.commentAt.getTime());
  counts.elegiveis = candidates.length;
  counts.elegiveisPorGrafia = candidates.filter((c) => c.matchedBy === "grafia" || c.matchedBy === "extra").length;
  return { candidates, counts };
}

// ─── Link do post ────────────────────────────────────────────────────────────

/** "https://www.instagram.com/reel/De0mG9WO7kT/" -> { shortcode }; "1789..." -> { mediaId }. */
export function parsePostRef(ref: string): { mediaId?: string; shortcode?: string } | null {
  const value = ref.trim();
  if (!value) return null;
  if (/^\d{8,}$/.test(value)) return { mediaId: value };
  const url = /instagram\.com\/(?:[^/]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/i.exec(value);
  if (url) return { shortcode: url[1] };
  if (/^[A-Za-z0-9_-]{6,20}$/.test(value)) return { shortcode: value };
  return null;
}

// ─── Erros do envio ──────────────────────────────────────────────────────────

export type FailureKind = "rate_limit" | "definitivo" | "fora_da_janela" | "talvez_entregue" | "canal_off" | "outro";

/** Lê o motivo gravado no FlowRun.stopReason ("Meta API Error 4: ...") e diz o que fazer. */
export function classifyFailure(reason: string | null | undefined): { kind: FailureKind; label: string } {
  const r = reason ?? "";
  if (r === "maybe_sent") return { kind: "talvez_entregue", label: "talvez entregue (a Meta não confirmou; não reenviado)" };
  if (r === "channel_off") return { kind: "canal_off", label: "canal desconectado" };
  if (r === "window_closed" || /1545041|window|551/i.test(r)) return { kind: "fora_da_janela", label: "fora da janela de resposta" };
  const code = /Error (\d+)/i.exec(r)?.[1];
  if (code && ["4", "17", "32", "613", "368"].includes(code)) return { kind: "rate_limit", label: `limite da Meta (erro ${code})` };
  if (code === "100" || /invalid for a private reply|archived|does not exist|not found/i.test(r)) {
    return { kind: "definitivo", label: "comentário sem resposta privada possível (erro 100: conversa arquivada, inexistente ou já respondida)" };
  }
  if (code === "190") return { kind: "canal_off", label: "token recusado pela Meta" };
  return { kind: "outro", label: r ? r.slice(0, 160) : "falha sem motivo" };
}

// ─── Ritmo ───────────────────────────────────────────────────────────────────

export type Pace = { intervaloMinMs: number; intervaloMaxMs: number; tetoHora: number };

export const PACE_DEFAULT: Pace = { intervaloMinMs: 2000, intervaloMaxMs: 4000, tetoHora: 400 };
/** Piso e teto de segurança: nunca mais rápido que 1 a cada 1,5 s nem mais de 600 por hora. */
export const PACE_LIMITS = { minIntervaloMs: 1500, maxIntervaloMs: 120_000, maxTetoHora: 600 };

export function normalizePace(input: { intervaloMinSegundos?: unknown; intervaloMaxSegundos?: unknown; tetoPorHora?: unknown }): Pace {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const min = num(input.intervaloMinSegundos);
  const max = num(input.intervaloMaxSegundos);
  const teto = num(input.tetoPorHora);
  let a = min !== null ? Math.round(min * 1000) : PACE_DEFAULT.intervaloMinMs;
  let b = max !== null ? Math.round(max * 1000) : Math.max(PACE_DEFAULT.intervaloMaxMs, a);
  a = Math.min(Math.max(a, PACE_LIMITS.minIntervaloMs), PACE_LIMITS.maxIntervaloMs);
  b = Math.min(Math.max(b, a), PACE_LIMITS.maxIntervaloMs);
  const t = teto !== null ? Math.round(teto) : PACE_DEFAULT.tetoHora;
  return { intervaloMinMs: a, intervaloMaxMs: b, tetoHora: Math.min(Math.max(t, 1), PACE_LIMITS.maxTetoHora) };
}

export function nextDelayMs(pace: Pace, random: () => number = Math.random): number {
  return pace.intervaloMinMs + Math.floor(random() * (pace.intervaloMaxMs - pace.intervaloMinMs + 1));
}

/** Passou do teto da hora? Devolve quando liberar (ms) ou 0. */
export function hourlyPauseMs(sentTimestampsMs: number[], tetoHora: number, nowMs: number): number {
  const lastHour = sentTimestampsMs.filter((t) => nowMs - t < 3_600_000).sort((a, b) => a - b);
  if (lastHour.length < tetoHora) return 0;
  const idx = lastHour.length - tetoHora;
  return Math.max(lastHour[idx] + 3_600_000 - nowMs + 1_000, 1_000);
}

export const RATE_LIMIT_PAUSE_MS = 30 * 60_000;
/** Vagas do balde da Meta (750/h) deixadas livres pros comentários novos (webhook). */
export const BUCKET_RESERVE = 150;
