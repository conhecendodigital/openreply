/**
 * Etapa 6: minimal rich text of a funnel, never HTML. **bold**, *italic*,
 * line breaks, "- " at the start of a line = list item, and the variables
 * {resposta.<name>} (labels the visitor picked). The player renders the
 * result with <p>, <ul><li>, <strong> and <em>. Browser-safe.
 */
export type TextRun = { text: string; bold?: boolean; italic?: boolean };
export type TextLine = { kind: "p" | "li"; runs: TextRun[] };

const VARIABLE = /\{resposta\.([a-z0-9_-]{1,40})\}/g;
const PLACEHOLDER = /\[[^\]]{2,}\]/;

/** {resposta.<name>} -> labels picked; no answer = "". */
export function interpolate(text: string, answers?: Record<string, string>): string {
  return String(text ?? "").replace(VARIABLE, (_m, name: string) => answers?.[name] ?? "");
}

export function hasPlaceholder(text: string | null | undefined): boolean {
  return typeof text === "string" && PLACEHOLDER.test(text);
}

/** First [placeholder] in the text, for the "what is missing" list. */
export function firstPlaceholder(text: string | null | undefined): string | null {
  if (typeof text !== "string") return null;
  const m = PLACEHOLDER.exec(text);
  return m ? m[0].slice(0, 80) : null;
}

function runs(line: string): TextRun[] {
  const out: TextRun[] = [];
  const pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  for (let m = pattern.exec(line); m; m = pattern.exec(line)) {
    if (m.index > last) out.push({ text: line.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ text: m[1], bold: true });
    else out.push({ text: m[2], italic: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out;
}

export function parseRichText(text: string, answers?: Record<string, string>): TextLine[] {
  const lines = interpolate(text, answers).replace(/\r\n?/g, "\n").split("\n");
  const out: TextLine[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (/^\s*- /.test(line)) out.push({ kind: "li", runs: runs(line.replace(/^\s*- /, "")) });
    else out.push({ kind: "p", runs: runs(line) });
  }
  return out;
}
