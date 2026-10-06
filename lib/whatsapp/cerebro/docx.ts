/**
 * Texto de um documento do Word (.docx), sem dependência nova.
 *
 * O .docx é um zip. Lemos o diretório central do zip, achamos
 * word/document.xml, abrimos com o zlib do próprio Node (inflateRaw, com teto
 * de tamanho contra zip bomba) e tiramos o texto dos parágrafos. Texto apagado
 * no controle de alterações (w:delText) fica de fora. Tipo conferido pelos
 * bytes, nunca pelo nome ou pelo Content-Type do navegador.
 *
 * Só no servidor. Nada aqui loga o texto.
 */
import { inflateRawSync } from "node:zlib";

export type DocxErrorCode = "not_docx" | "docx_encrypted" | "docx_invalid" | "docx_no_text" | "docx_too_large";

export class DocxError extends Error {
  constructor(public readonly code: DocxErrorCode) {
    super(code);
    this.name = "DocxError";
  }
}

/** document.xml aberto, no máximo (um briefing tem uns 200 KB). */
export const MAX_DOCX_XML_BYTES = 30 * 1024 * 1024;

const ZIP_LOCAL = 0x04034b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_END = 0x06054b50;

/** Zip (começa com "PK\x03\x04"). Pode ser docx, xlsx, qualquer zip. */
export function isZipBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** Arquivo do Office com senha (vem no formato antigo CFB, não em zip). */
export function isCfbBytes(bytes: Uint8Array): boolean {
  const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return bytes.length >= 8 && sig.every((b, i) => bytes[i] === b);
}

type Entry = { name: string; method: number; compressedSize: number; size: number; localOffset: number; flags: number };

function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function centralDirectory(bytes: Uint8Array): Entry[] {
  const dv = view(bytes);
  // O registro do fim fica nos últimos 22 bytes + comentário (até 64 KB).
  const min = Math.max(0, bytes.length - 22 - 0xffff);
  let end = -1;
  for (let i = bytes.length - 22; i >= min; i--) {
    if (dv.getUint32(i, true) === ZIP_END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new DocxError("docx_invalid");
  const count = dv.getUint16(end + 10, true);
  const cdOffset = dv.getUint32(end + 16, true);
  if (cdOffset === 0xffffffff || cdOffset >= bytes.length) throw new DocxError("docx_invalid");
  const entries: Entry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || dv.getUint32(p, true) !== ZIP_CENTRAL) throw new DocxError("docx_invalid");
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const compressedSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = Buffer.from(bytes.subarray(p + 46, p + 46 + nameLen)).toString("utf8");
    entries.push({ name, method, compressedSize, size, localOffset, flags });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntry(bytes: Uint8Array, e: Entry): Buffer {
  const dv = view(bytes);
  if (e.flags & 0x1) throw new DocxError("docx_encrypted");
  if (e.size > MAX_DOCX_XML_BYTES) throw new DocxError("docx_too_large");
  const p = e.localOffset;
  if (p + 30 > bytes.length || dv.getUint32(p, true) !== ZIP_LOCAL) throw new DocxError("docx_invalid");
  const start = p + 30 + dv.getUint16(p + 26, true) + dv.getUint16(p + 28, true);
  const end = start + e.compressedSize;
  if (end > bytes.length) throw new DocxError("docx_invalid");
  const raw = bytes.subarray(start, end);
  if (e.method === 0) return Buffer.from(raw);
  if (e.method !== 8) throw new DocxError("docx_invalid");
  try {
    return inflateRawSync(raw, { maxOutputLength: MAX_DOCX_XML_BYTES });
  } catch (error) {
    if ((error as { code?: string })?.code === "ERR_BUFFER_TOO_LARGE") throw new DocxError("docx_too_large");
    throw new DocxError("docx_invalid");
  }
}

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1] === "x" || code[1] === "X" ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/**
 * Texto do word/document.xml: um parágrafo por linha, tabulação como espaço,
 * quebra de linha mantida, item de lista com "• " na frente, linha de tabela
 * com as células separadas por " | ".
 */
export function documentXmlToText(xml: string): string {
  const lines: string[] = [];
  let line = "";
  let inText = false;
  let isList = false;
  let cells: string[] | null = null;
  const tag = /<(\/?)([a-zA-Z0-9]+:[a-zA-Z0-9]+|[a-zA-Z0-9]+)\b[^>]*?(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  const endParagraph = () => {
    const text = (isList && line.trim() ? `• ${line}` : line).replace(/[ \t]+/g, " ").trim();
    if (cells) {
      if (text) cells[cells.length - 1] = cells[cells.length - 1] ? `${cells[cells.length - 1]} ${text}` : text;
    } else {
      lines.push(text);
    }
    line = "";
    isList = false;
  };
  while ((m = tag.exec(xml))) {
    const [, closing, name, selfClosing, text] = m;
    if (text !== undefined) {
      if (inText) line += decodeXmlEntities(text);
      continue;
    }
    switch (name) {
      case "w:t":
        inText = !closing && !selfClosing;
        break;
      case "w:tab":
        if (!closing) line += " ";
        break;
      case "w:br":
      case "w:cr":
        if (!closing) line += "\n";
        break;
      case "w:numPr":
        if (!closing) isList = true;
        break;
      case "w:p":
        if (closing) endParagraph();
        else if (selfClosing && !cells) lines.push("");
        break;
      case "w:tr":
        if (!closing && !selfClosing) cells = [];
        else if (closing && cells) {
          lines.push(cells.filter(Boolean).join(" | "));
          cells = null;
        }
        break;
      case "w:tc":
        if (!closing && !selfClosing && cells) cells.push("");
        break;
      default:
        break;
    }
  }
  if (line.trim()) endParagraph();
  return lines
    .join("\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Texto de um .docx. Joga DocxError com código curto. */
export function extractDocxText(bytes: Uint8Array, options: { maxChars?: number } = {}): { text: string; truncated: boolean } {
  if (isCfbBytes(bytes)) throw new DocxError("docx_encrypted");
  if (!isZipBytes(bytes)) throw new DocxError("not_docx");
  const entries = centralDirectory(bytes);
  if (entries.some((e) => e.name === "EncryptionInfo")) throw new DocxError("docx_encrypted");
  const main = entries.find((e) => e.name === "word/document.xml");
  if (!main) throw new DocxError("not_docx");
  const text = documentXmlToText(readEntry(bytes, main).toString("utf8"));
  if (!text.replace(/[•|\s]/g, "")) throw new DocxError("docx_no_text");
  const max = options.maxChars ?? Number.POSITIVE_INFINITY;
  return text.length > max ? { text: text.slice(0, max), truncated: true } : { text, truncated: false };
}

/** True quando é um zip com word/document.xml (sem abrir o XML). */
export function isDocxBytes(bytes: Uint8Array): boolean {
  if (!isZipBytes(bytes)) return false;
  try {
    return centralDirectory(bytes).some((e) => e.name === "word/document.xml");
  } catch {
    return false;
  }
}
