/**
 * O tipo do arquivo é conferido pelos bytes, nunca só pelo mime que o gateway
 * mandou.
 */

export type FormatoImagem = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

/** Formato da imagem pelos primeiros bytes (os que a Anthropic e a OpenAI aceitam). */
export function formatoImagem(b: Uint8Array): FormatoImagem | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

export type FormatoAudio = { ext: string; mime: string };

/** Extensão que a OpenAI reconhece pro arquivo de áudio (ela olha o nome). */
export function formatoAudio(b: Uint8Array, mimeDeclarado: string | null): FormatoAudio {
  const ascii = (i: number, n: number) => String.fromCharCode(...b.slice(i, i + n));
  if (b.length >= 4 && ascii(0, 4) === "OggS") return { ext: "ogg", mime: "audio/ogg" };
  if (b.length >= 12 && ascii(4, 4) === "ftyp") return { ext: "m4a", mime: "audio/mp4" };
  if (b.length >= 3 && (ascii(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0))) return { ext: "mp3", mime: "audio/mpeg" };
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return { ext: "wav", mime: "audio/wav" };
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { ext: "webm", mime: "audio/webm" };
  const m = (mimeDeclarado ?? "").toLowerCase();
  if (m.includes("ogg") || m.includes("opus")) return { ext: "ogg", mime: "audio/ogg" };
  if (m.includes("mp4") || m.includes("aac") || m.includes("m4a")) return { ext: "m4a", mime: "audio/mp4" };
  if (m.includes("mpeg") || m.includes("mp3")) return { ext: "mp3", mime: "audio/mpeg" };
  return { ext: "ogg", mime: "audio/ogg" };
}

/**
 * Duração de um Ogg (o áudio de voz do WhatsApp é Ogg Opus), em segundos:
 * posição do último pacote (granule position da última página "OggS") / 48 kHz.
 * null quando não é Ogg ou não deu pra ler.
 */
export function duracaoOggSegundos(b: Uint8Array): number | null {
  if (b.length < 27 || b[0] !== 0x4f || b[1] !== 0x67 || b[2] !== 0x67 || b[3] !== 0x53) return null;
  for (let i = b.length - 27; i >= 0; i--) {
    if (b[i] === 0x4f && b[i + 1] === 0x67 && b[i + 2] === 0x67 && b[i + 3] === 0x53) {
      const view = new DataView(b.buffer, b.byteOffset + i + 6, 8);
      const lo = view.getUint32(0, true);
      const hi = view.getUint32(4, true);
      if (hi === 0xffffffff && lo === 0xffffffff) continue;
      const granule = hi * 2 ** 32 + lo;
      return granule / 48_000;
    }
  }
  return null;
}
