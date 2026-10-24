/**
 * 24/10/2026: seções do menu lateral começam fechadas (pedido do Matheus).
 *
 * Regras:
 * - A seção da página aberta começa aberta; as outras, fechadas.
 * - Clicar no título abre ou fecha. Abrir uma seção fecha as outras que a
 *   pessoa tinha aberto à mão (a da página atual continua aberta).
 * - O que a pessoa abriu ou fechou vale só para a página em que ela está.
 *   Trocou de página, o menu volta ao padrão: só a seção da página aberta.
 *   Antes (06/10) a escolha ficava salva pra sempre e o menu ia ficando todo aberto.
 */
export interface GruposSalvos {
  /** Página em que a escolha foi feita. */
  path: string;
  /** Título da seção → aberta (true) ou fechada (false) à mão. */
  open: Record<string, boolean>;
}

export const GRUPOS_VAZIO: GruposSalvos = { path: "", open: {} };

export function lerGrupos(raw: string | null | undefined): GruposSalvos {
  if (!raw) return GRUPOS_VAZIO;
  try {
    const parsed = JSON.parse(raw) as Partial<GruposSalvos>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.path !== "string" || !parsed.open || typeof parsed.open !== "object") {
      return GRUPOS_VAZIO;
    }
    const open: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed.open)) if (typeof v === "boolean") open[k] = v;
    return { path: parsed.path, open };
  } catch {
    return GRUPOS_VAZIO;
  }
}

/** Escolhas que valem nesta página (as de outra página são ignoradas). */
function escolhas(salvos: GruposSalvos, pathname: string): Record<string, boolean> {
  return salvos.path === pathname ? salvos.open : {};
}

export function grupoAberto(salvos: GruposSalvos, pathname: string, titulo: string, temPaginaAtual: boolean): boolean {
  return escolhas(salvos, pathname)[titulo] ?? temPaginaAtual;
}

export function alternarGrupo(salvos: GruposSalvos, pathname: string, titulo: string, abertoAgora: boolean): GruposSalvos {
  const base = escolhas(salvos, pathname);
  if (abertoAgora) return { path: pathname, open: { ...base, [titulo]: false } };
  // Abrindo: fecha as que a pessoa tinha aberto à mão, guarda as que ela fechou.
  const open: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(base)) if (v === false) open[k] = false;
  open[titulo] = true;
  return { path: pathname, open };
}
