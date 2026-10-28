/**
 * 28/10/2026: padrão do canal do YouTube "meus vídeos NÃO são para crianças".
 * É uma declaração legal do DONO ao YouTube: só a tela (sessão humana) liga, uma vez por canal.
 * Com o padrão ligado, o vídeo sem resposta própria herda `selfDeclaredMadeForKids: false`.
 * A resposta própria do vídeo (true ou false) sempre prevalece. Desligado, nada muda.
 */

export const KIDS_FIELD = "selfDeclaredMadeForKids";

function asObject(settings: unknown): Record<string, unknown> {
  return settings && typeof settings === "object" && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {};
}

export function hasOwnKidsAnswer(settings: unknown): boolean {
  return typeof asObject(settings)[KIDS_FIELD] === "boolean";
}

/** Devolve as opções com o padrão aplicado; se não precisa aplicar, devolve o mesmo objeto. */
export function withKidsDefault<T>(settings: T, defaultOn: boolean): T | (Record<string, unknown> & { selfDeclaredMadeForKids: false }) {
  if (!defaultOn || hasOwnKidsAnswer(settings)) return settings;
  return { ...asObject(settings), [KIDS_FIELD]: false as const } as Record<string, unknown> & { selfDeclaredMadeForKids: false };
}

/** Chave de API/MCP nunca declara "para crianças": tira o campo das opções. */
export function stripKidsAnswer(settings: Record<string, unknown>): Record<string, unknown> {
  const { [KIDS_FIELD]: _removed, ...rest } = settings;
  void _removed;
  return rest;
}
