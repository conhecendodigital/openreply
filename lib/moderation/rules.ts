/**
 * Comment moderation rules: pure functions, no I/O.
 *
 * The link detection (scheme/www links matched case-insensitively, bare
 * domains only in lowercase so "ban.Shop" after a missing space is not a link)
 * and the phone pattern are adapted from ChatbotX
 * (apps/worker/src/integration/handlers/comment-automation/hide-comments.ts).
 * Copyright (c) 2024-present AhaChat LLC, MIT License.
 */
import { foldDiacritics } from "@/lib/utils/keyword-matcher";

export const MODERATION_CATEGORIES = ["spam_link", "scam", "politics", "offense"] as const;
export type ModerationCategory = (typeof MODERATION_CATEGORIES)[number];

export type ModerationVerdict = "ok" | ModerationCategory | "blocked_term" | "jev";

export const DEFAULT_CATEGORIES: ModerationCategory[] = ["spam_link", "scam", "offense"];

export const MAX_TERMS = 200;
export const MAX_TERM_LENGTH = 60;

export interface RuleSettings {
  categories: string[];
  blockedTerms: string[];
  allowedTerms: string[];
}

export interface ClassifyResult {
  verdict: ModerationVerdict;
  matchedRule: string | null;
  reason: string | null;
}

/** Lowercase, Latin accents removed, whitespace collapsed. */
export function normalize(text: string): string {
  return foldDiacritics(text ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole-word/phrase match on normalized text: the term may not be glued to
 * another letter or digit ("pix" matches "manda o pix" but not "pixel").
 */
export function containsTerm(normalizedText: string, term: string): boolean {
  const t = normalize(term);
  if (!t) return false;
  // Boundaries only on a side that ends in a letter/digit, so "ganhe r$"
  // still matches "ganhe r$500".
  const lead = /^[\p{L}\p{N}]/u.test(t) ? "(?<![\\p{L}\\p{N}])" : "";
  const trail = /[\p{L}\p{N}]$/u.test(t) ? "(?![\\p{L}\\p{N}])" : "";
  const re = new RegExp(`${lead}${escapeRegex(t)}${trail}`, "u");
  return re.test(normalizedText);
}

function firstTerm(normalizedText: string, terms: readonly string[]): string | null {
  for (const term of terms) {
    if (containsTerm(normalizedText, term)) return term;
  }
  return null;
}

// ─── Links and phones ───────────────────────────────────────────────────────

const SCHEME_LINK_RE = /https?:\/\/\S+|www\.\S+/i;
// Lowercase only, on purpose (see header).
const BARE_DOMAIN_RE =
  /(?<![\p{L}\p{N}@.])[a-z0-9-]+\.(?:com|net|org|io|shop|store|info|biz|site|online|xyz|link|club|app|com\.br|net\.br)(?![\p{L}\p{N}])/gu;
// Tools the profile teaches: a lead writing "uso o chatgpt.com" is not spam.
// Only for bare domains; a full https:// link is still flagged.
const SAFE_BARE_DOMAINS = new Set([
  "chatgpt.com",
  "openai.com",
  "google.com",
  "canva.com",
  "instagram.com",
  "youtube.com",
  "capcut.com",
  "midjourney.com",
  "github.com",
  "whatsapp.com",
  "claude.com",
  "anthropic.com",
  "gamma.app",
  "heygen.com",
  "elevenlabs.io",
  "suno.com",
  "notion.com",
  "freepik.com",
  "runwayml.com",
]);
const SHORTENER_RE =
  /\b(?:bit\.ly|wa\.me|t\.me|chat\.whatsapp\.com|api\.whatsapp\.com|linktr\.ee|tinyurl\.com|cutt\.ly|encurtador\.com\.br|abre\.ai|is\.gd|shorturl\.at|beacons\.ai)\b/i;
// Not glued to other digits, so a long code/order number is not a phone.
const PHONE_RE = /(?<!\d)(?:\+?55[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}(?!\d)/;

export function findLink(text: string): string | null {
  const shortener = SHORTENER_RE.exec(text);
  if (shortener) return shortener[0];
  const scheme = SCHEME_LINK_RE.exec(text);
  if (scheme) return scheme[0];
  for (const bare of text.matchAll(BARE_DOMAIN_RE)) {
    if (!SAFE_BARE_DOMAINS.has(bare[0])) return bare[0];
  }
  return null;
}

export function findPhone(text: string): string | null {
  const match = PHONE_RE.exec(text);
  if (!match) return null;
  const digits = match[0].replace(/\D/g, "");
  // 10-11 digits (DDD + number) or 12-13 with +55: a real Brazilian phone.
  return digits.length >= 10 && digits.length <= 13 ? match[0] : null;
}

// ─── Built-in categories (PT-BR) ─────────────────────────────────────────────

const SPAM_TERMS = [
  "segue de volta",
  "sigo de volta",
  "sigam de volta",
  "follow back",
  "sdv",
  "visita meu perfil",
  "visite meu perfil",
  "olha meu perfil",
  "confira meu perfil",
  "passa no meu perfil",
  "da uma olhada no meu perfil",
  "chama no direct pra ganhar",
  "me chama no direct pra ganhar",
  "ganhar seguidores",
  "seguidores gratis",
  "compre seguidores",
  "comprar seguidores",
  "curtidas gratis",
  "divulgo seu perfil",
  "parceria paga",
];

// Phrases, not single words: a lead asking "aceita pix?" or a security
// question about "hacker" must not be flagged (Tech/Segurança is the biggest
// content category of the profile).
const SCAM_TERMS = [
  "pix caindo",
  "pix na hora",
  "pix na conta",
  "cai no pix",
  "caiu no pix",
  "recebi no pix",
  "ganhei no pix",
  // Not "renda extra" alone: "como fazer renda extra com IA?" is a lead.
  "renda extra garantida",
  "ganhe r$",
  "ganhei r$",
  "ganha r$",
  "lucro garantido",
  "retorno garantido",
  "dinheiro facil",
  "multiplicar seu dinheiro",
  "multiplica seu dinheiro",
  // Not "invista"/"trader" alone: "invista em você" and "sou trader, amei"
  // are normal comments.
  "invista agora",
  "invista comigo",
  "invista e ganhe",
  "invista r$",
  "day trade",
  "forex",
  "opcoes binarias",
  "chama no zap",
  "chama no whats",
  "chama no whatsapp",
  "me chama no zap",
  "me chama no whatsapp",
  "foi sorteado",
  "voce foi sorteado",
  "voce ganhou",
  "sou hacker",
  "hacker profissional",
  "contrate um hacker",
  "invado conta",
  "invado instagram",
  "recupero conta",
  "recupero sua conta",
  // Not "conta hackeada"/"recuperar conta": victims ask exactly that on the
  // Tech/Segurança posts. The scammer's offer ("recupero conta") stays.
  "tigrinho",
  "fortune tiger",
  "aviator",
  "plataforma pagando",
];

// Whole words and compound phrases only: "PT"/"PL" alone and "direita" alone
// produce too many false positives (Portugal, directions), so they are out.
const POLITICS_TERMS = [
  "lula",
  "bolsonaro",
  "bolsonarista",
  "bolsominion",
  "petista",
  "lulista",
  "esquerdista",
  "esquerdopata",
  "direitista",
  "comunista",
  "faz o l",
  "fora lula",
  "fora bolsonaro",
  "stf",
  "xandao",
  "alexandre de moraes",
  "eleicao",
  "eleicoes",
  "urna eletronica",
];

const OFFENSE_TERMS = [
  "idiota",
  "imbecil",
  "otario",
  "otaria",
  "babaca",
  "vagabundo",
  "vagabunda",
  "arrombado",
  "arrombada",
  "filho da puta",
  "fdp",
  "desgracado",
  "desgracada",
  "retardado",
  "retardada",
  "vai se foder",
  "vai tomar no cu",
  "vsf",
  "vtnc",
  "lixo humano",
  // Not "golpista": "cuidado com golpista" is a normal comment on security posts.
];

export const CATEGORY_TERMS: Record<ModerationCategory, readonly string[]> = {
  spam_link: SPAM_TERMS,
  scam: SCAM_TERMS,
  politics: POLITICS_TERMS,
  offense: OFFENSE_TERMS,
};

/** First allowed term the comment contains (it is then never hidden). */
export function findAllowedTerm(text: string, allowedTerms: string[]): string | null {
  return firstTerm(normalize(text), allowedTerms);
}

/**
 * Classify a comment with the local rules. The owner's blocked terms win over
 * the built-in categories. Allowed terms are a protection, checked by the
 * caller (findAllowedTerm), not a verdict.
 */
export function classify(text: string, settings: RuleSettings): ClassifyResult {
  const raw = text ?? "";
  const normalized = normalize(raw);
  if (!normalized) return { verdict: "ok", matchedRule: null, reason: null };

  const blocked = firstTerm(normalized, settings.blockedTerms);
  if (blocked) {
    return { verdict: "blocked_term", matchedRule: blocked, reason: `termo bloqueado: ${blocked}` };
  }

  const enabled = new Set(settings.categories);

  if (enabled.has("spam_link")) {
    const link = findLink(raw);
    if (link) return { verdict: "spam_link", matchedRule: "link", reason: `link: ${link}` };
    const phone = findPhone(raw);
    if (phone) return { verdict: "spam_link", matchedRule: "phone", reason: `telefone: ${phone}` };
  }

  for (const category of ["spam_link", "scam", "offense", "politics"] as const) {
    if (!enabled.has(category)) continue;
    const term = firstTerm(normalized, CATEGORY_TERMS[category]);
    if (term) {
      return { verdict: category, matchedRule: term, reason: `${category}: ${term}` };
    }
  }

  return { verdict: "ok", matchedRule: null, reason: null };
}

/** Clean a user-provided list: trimmed, deduped, capped. */
export function cleanTerms(terms: unknown): string[] {
  if (!Array.isArray(terms)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of terms) {
    if (typeof value !== "string") continue;
    const term = value.replace(/\s+/g, " ").trim().slice(0, MAX_TERM_LENGTH);
    const key = normalize(term);
    if (!term || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}

export function wordCount(text: string): number {
  return normalize(text).split(" ").filter(Boolean).length;
}
