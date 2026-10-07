/**
 * Does this conversation still need an answer from us? (2026-10-07)
 *
 * "Unanswered" used to mean only "the last stored DM is theirs", so the
 * vendedor proposed a draft (and the Approvals page filled up) for messages
 * that close a conversation: "obrigado", "recebi", "amém", an emoji, a heart
 * on a story, a story repost. Those do not need an answer. Anything with a
 * question, a request, or that answers a question we asked still does, and a
 * message with no text that is not about a story (audio, photo) still does too.
 */

type Msg = { fromMe: boolean; text: string | null; storyReply: boolean };

// Every word of the message is one of these (after dropping FILLER) → closing.
const CLOSING = new Set(
  (
    "obrigado obrigada obrigadão obrigadao brigado brigada obg obgd grato grata agradecido agradecida agradeco " +
    "valeu vlw valeuu tmj recebi recebido chegou chegando consegui ok okay okk blz beleza top show perfeito perfeita " +
    "massa otimo otima maravilha maravilhoso maravilhosa lindo linda amei amo incrivel sensacional demais " +
    "amem amen gloria aleluia abencoe abencoado abencoada abencoada " +
    "kk kkk kkkk kkkkk haha hahaha rs rsrs boa bom legal entendi certo combinado"
  ).split(/\s+/)
);
const FILLER = new Set(
  (
    "muito muita mto mt mano irmao irma amigo amiga matheus math thais deus a o e de do da te ti voce vc cê ce " +
    "pra pro por pela pelo pelas pelos isso esse essa tudo ja aqui entao ta tá ai sempre mesmo mais nada sim senhor que q meu minha resposta dica dicas conteudo video post"
  ).split(/\s+/)
);
// "sim", "quero", "manda"... answer something or ask for something: always reply.
const ASKS = /\b(sim|quero|queria|manda|envia|link|como|quanto|qual|onde|quando|porque|por que|pode|consegue|ajuda|preciso|nao (recebi|chegou|consegui|abre|abriu))\b/;

function plain(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/(.)\1{2,}/g, "$1$1"); // "obrigadooo" → "obrigadoo", "kkkkkk" → "kk"
}

/** True when the message is only a thank-you, an ok, a laugh, an emoji... */
export function isClosingMessage(text: string): boolean {
  if (text.includes("?")) return false;
  const p = plain(text);
  if (ASKS.test(p)) return false;
  const words = p.match(/[a-z0-9]+/g) ?? [];
  if (words.length === 0) return true; // only emoji or punctuation
  if (words.length > 8) return false;
  const rest = words.filter((w) => !FILLER.has(w));
  if (rest.length === 0) return false; // "sim senhor", "e ai": not a closing we can be sure of
  return rest.every((w) => CLOSING.has(w) || CLOSING.has(w.replace(/(.)\1+$/, "$1")) || /^(k+|(ha)+h?|(rs)+)$/.test(w));
}

/**
 * `messages` oldest first, as presentContact returns them. Only called when the
 * last one is theirs.
 */
export function needsReply(messages: Msg[]): boolean {
  const last = messages[messages.length - 1];
  if (!last || last.fromMe) return false;
  // If our last message asked something, a short "ok" or "top" may be the answer.
  const ours = [...messages].reverse().find((m) => m.fromMe);
  if (ours?.text?.includes("?")) return true;
  const text = last.text?.trim() ?? "";
  if (!text) return !last.storyReply; // a heart or a repost of a story: no; an audio or a photo: yes
  // A vote on a story poll or quiz ("2", "A", "sim" is still kept by ASKS): no.
  if (last.storyReply && /^[\p{L}\p{N}]{1,3}[.!]?$/u.test(text) && !ASKS.test(plain(text))) return false;
  return !isClosingMessage(text);
}
