/**
 * Etapa 6: ids of steps, blocks and options ("s_k3j9x2ab"). Browser-safe
 * (Web Crypto exists in the browser and in Node 20).
 */
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

export function newId(prefix: "s" | "b" | "o"): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}
