/**
 * Corta o texto do PDF em pedaços com sobreposição.
 *
 * Respeita parágrafo e frase sempre que dá: um pedaço só quebra no meio de uma
 * frase quando a frase sozinha é maior que o tamanho alvo. Cada pedaço novo
 * começa com o final do anterior (sobreposição), cortado em fim de palavra,
 * pra uma resposta que cai na divisa não perder o contexto.
 */
import { CHUNK_OVERLAP_CHARS, CHUNK_SIZE_CHARS, MAX_CHUNKS_PER_DOC } from "@/lib/whatsapp/cerebro/limits";

export interface TextChunk {
  position: number;
  /** Página onde o pedaço começa (1 = primeira). */
  page: number;
  content: string;
  tokenEstimate: number;
}

export interface ChunkOptions {
  size?: number;
  overlap?: number;
  maxChunks?: number;
}

/** Estimativa grosseira (português dá ~4 caracteres por token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

interface Unit {
  text: string;
  page: number;
}

function splitSentences(paragraph: string): string[] {
  const parts = paragraph.match(/[^.!?…]+(?:[.!?…]+["')\]]*|$)\s*/g);
  return (parts ?? [paragraph]).map((s) => s.trim()).filter(Boolean);
}

/** Quebra um texto grande demais por palavras (e palavra gigante por caractere). */
function hardSplit(text: string, size: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    if (word.length > size) {
      if (current) {
        out.push(current);
        current = "";
      }
      for (let i = 0; i < word.length; i += size) out.push(word.slice(i, i + size));
      continue;
    }
    if (current && current.length + 1 + word.length > size) {
      out.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }
  if (current) out.push(current);
  return out;
}

function toUnits(pages: string[], size: number): Unit[] {
  const units: Unit[] = [];
  pages.forEach((pageText, index) => {
    const page = index + 1;
    for (const paragraph of pageText.split(/\n{2,}/)) {
      const p = paragraph.replace(/\s*\n\s*/g, " ").trim();
      if (!p) continue;
      if (p.length <= size) {
        units.push({ text: p, page });
        continue;
      }
      for (const sentence of splitSentences(p)) {
        if (sentence.length <= size) units.push({ text: sentence, page });
        else for (const piece of hardSplit(sentence, size)) units.push({ text: piece, page });
      }
    }
  });
  return units;
}

/** Final do texto com até `overlap` caracteres, começando numa palavra inteira. */
export function overlapTail(text: string, overlap: number): string {
  if (overlap <= 0 || !text) return "";
  if (text.length <= overlap) return text;
  const tail = text.slice(text.length - overlap);
  const firstSpace = tail.search(/\s/);
  return (firstSpace >= 0 ? tail.slice(firstSpace + 1) : tail).trim();
}

/**
 * Pedaços do documento. `pages[i]` é o texto da página i+1.
 * Para em `maxChunks` (protege o gasto de embedding num PDF enorme).
 */
export function chunkPages(pages: string[], options: ChunkOptions = {}): TextChunk[] {
  const size = Math.max(200, options.size ?? CHUNK_SIZE_CHARS);
  const overlap = Math.min(Math.max(0, options.overlap ?? CHUNK_OVERLAP_CHARS), Math.floor(size / 2));
  const maxChunks = options.maxChunks ?? MAX_CHUNKS_PER_DOC;

  const chunks: TextChunk[] = [];
  let current = "";
  let currentPage = 1;
  let hasNew = false; // o pedaço atual tem algo além da sobreposição

  const flush = () => {
    const content = current.trim();
    if (!content || !hasNew) return;
    chunks.push({ position: chunks.length, page: currentPage, content, tokenEstimate: estimateTokens(content) });
    current = overlapTail(content, overlap);
    hasNew = false;
  };

  for (const unit of toUnits(pages, size)) {
    if (chunks.length >= maxChunks) break;
    const joined = current ? `${current}\n${unit.text}` : unit.text;
    if (joined.length > size && hasNew) {
      flush();
      if (chunks.length >= maxChunks) break;
    }
    if (!hasNew) currentPage = unit.page;
    // A sobreposição + a unidade podem passar do alvo; a sobreposição cede.
    if (current && current.length + 1 + unit.text.length > size) {
      current = overlapTail(current, Math.max(0, size - unit.text.length - 1));
    }
    current = current ? `${current}\n${unit.text}` : unit.text;
    hasNew = true;
  }
  if (chunks.length < maxChunks) flush();
  return chunks;
}
