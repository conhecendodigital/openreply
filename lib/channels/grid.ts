/**
 * Grade de canais (23/10/2026): junta num formato só os canais da página Canais
 * (Instagram, Facebook, TikTok e YouTube) e decide status e linha extra do cartão.
 * Lógica pura, sem React nem servidor, para testar sem tela.
 */
import type { SocialBrand } from "@/lib/social/brand-icons";

export type GridNetwork = Exclude<SocialBrand, "WHATSAPP">;
export type GridStatus = "ACTIVE" | "NEEDS_RECONNECT" | "DISCONNECTED";
/** Como o cartão mostra o estado: bolinha e cor. */
export type GridState = "connected" | "expiring" | "attention" | "reconnect" | "off";

export interface GridChannel {
  id: string;
  network: GridNetwork;
  /** Nome em destaque: @usuário no Instagram, nome da Página, título do canal. */
  name: string;
  /** Segunda linha opcional (nome por trás do @, @ do TikTok/YouTube). */
  subtitle: string | null;
  photoUrl: string | null;
  status: GridStatus;
  state: GridState;
  /** Uma linha extra no máximo: posts agendados ou dias para o token vencer. */
  extra: { kind: "scheduled"; count: number } | { kind: "token"; days: number } | null;
}

export const GRID_NETWORK_ORDER: GridNetwork[] = ["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE"];
/** Menos que isso e o token pede atenção (mesma régua da tela de detalhe). */
export const TOKEN_WARN_DAYS = 10;

interface OverviewCardLike {
  platform: "instagram" | "facebook";
  id: string;
  username: string;
  name: string | null;
  profilePictureUrl: string | null;
  status: GridStatus;
  tokenExpiresInDays: number | null;
  webhooksStale: boolean;
}

interface SocialLike {
  id: string;
  source: "social" | "channel";
  platform: "TIKTOK" | "YOUTUBE" | "INSTAGRAM" | "FACEBOOK";
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  status: string;
  missingScopes?: string[];
}

export function gridState(input: {
  status: GridStatus;
  tokenDays?: number | null;
  serious?: boolean;
  warn?: boolean;
}): GridState {
  if (input.status === "DISCONNECTED") return "off";
  if (input.status === "NEEDS_RECONNECT" || input.serious) return "reconnect";
  if (input.tokenDays != null && input.tokenDays < TOKEN_WARN_DAYS) return "expiring";
  if (input.warn) return "attention";
  return "connected";
}

function asStatus(status: string): GridStatus {
  return status === "NEEDS_RECONNECT" || status === "DISCONNECTED" ? status : "ACTIVE";
}

export function buildGrid(input: {
  instagram: OverviewCardLike[];
  social: SocialLike[];
  scheduledByAccount: Record<string, number>;
  seriousAlertIds?: Set<string>;
}): GridChannel[] {
  const out: GridChannel[] = [];
  for (const c of input.instagram) {
    const network: GridNetwork = c.platform === "facebook" ? "FACEBOOK" : "INSTAGRAM";
    const status = c.status;
    const state = gridState({
      status,
      tokenDays: c.tokenExpiresInDays,
      serious: input.seriousAlertIds?.has(c.id),
      warn: c.webhooksStale,
    });
    const scheduled = input.scheduledByAccount[c.id] ?? 0;
    out.push({
      id: c.id,
      network,
      name: network === "FACEBOOK" ? (c.name ?? c.username) : `@${c.username}`,
      subtitle: network === "FACEBOOK" ? null : c.name,
      photoUrl: c.profilePictureUrl,
      status,
      state,
      extra:
        status !== "DISCONNECTED" && c.tokenExpiresInDays != null && c.tokenExpiresInDays >= 0 && c.tokenExpiresInDays < TOKEN_WARN_DAYS
          ? { kind: "token", days: c.tokenExpiresInDays }
          : scheduled > 0
            ? { kind: "scheduled", count: scheduled }
            : null,
    });
  }
  for (const a of input.social) {
    if (a.source !== "social" || (a.platform !== "TIKTOK" && a.platform !== "YOUTUBE")) continue;
    const status = asStatus(a.status);
    const scheduled = input.scheduledByAccount[a.id] ?? 0;
    out.push({
      id: a.id,
      network: a.platform,
      name: a.displayName,
      subtitle: a.username ? `@${a.username}` : null,
      photoUrl: a.avatarUrl,
      status,
      state: gridState({ status, warn: (a.missingScopes?.length ?? 0) > 0 }),
      extra: scheduled > 0 ? { kind: "scheduled", count: scheduled } : null,
    });
  }
  return sortGrid(out);
}

/** Por rede (Instagram, Facebook, TikTok, YouTube) e, dentro, pelo nome. */
export function sortGrid(items: GridChannel[]): GridChannel[] {
  return [...items].sort(
    (a, b) =>
      GRID_NETWORK_ORDER.indexOf(a.network) - GRID_NETWORK_ORDER.indexOf(b.network) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

/** Quantos posts agendados cada conta tem. */
export function countScheduled(posts: { accountId?: string | null; status: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of posts) {
    if (p.status === "SCHEDULED" && p.accountId) out[p.accountId] = (out[p.accountId] ?? 0) + 1;
  }
  return out;
}
