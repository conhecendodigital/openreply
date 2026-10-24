/** Tipos e rótulos da página Canais, divididos entre a grade e a tela de detalhe. */
import type { BannerAlert } from "@/components/channel-alert-banner";

export type Status = "ACTIVE" | "NEEDS_RECONNECT" | "DISCONNECTED";
export type Role = "OWNER" | "ADMIN" | "MEMBER";

export interface InstagramCard {
  platform: "instagram" | "facebook";
  id: string;
  instagramId: string;
  username: string;
  name: string | null;
  profilePictureUrl: string | null;
  status: Status;
  connectedAt: string;
  reconnectedAt: string | null;
  disconnectedAt: string | null;
  tokenExpiresAt: string | null;
  tokenExpiresInDays: number | null;
  webhookSubscribed: boolean;
  webhookFields: string[];
  /** Expected fields (lib/meta/webhook-fields.ts) this account is not subscribed to. */
  missingWebhookFields?: string[];
  lastWebhookAt: string | null;
  webhooksStale: boolean;
  lastError: string | null;
  lastErrorAt: string | null;
  campaigns: { active: number; total: number };
  moderationMode: "OFF" | "OBSERVE" | "HIDE";
  contacts: number;
  pendingDrafts: number;
  alerts: BannerAlert[];
}

export interface ComingSoon {
  platform: "telegram" | "whatsapp" | "messenger" | "threads";
  name: string;
  requirements: string[];
}

export interface Overview {
  instagram: InstagramCard[];
  comingSoon: ComingSoon[];
  alerts: BannerAlert[];
}

/** The owner's words: Conectado / Precisa reconectar / Desconectado. */
export const STATUS_LABEL: Record<Status, { pt: string; en: string; tone: string; dot: string }> = {
  ACTIVE: { pt: "Conectado", en: "Connected", tone: "bg-success/10 text-success", dot: "bg-success" },
  NEEDS_RECONNECT: { pt: "Precisa reconectar", en: "Needs reconnect", tone: "bg-error/10 text-error", dot: "bg-error" },
  DISCONNECTED: { pt: "Desconectado", en: "Disconnected", tone: "bg-surface-hover text-muted", dot: "bg-muted" },
};

const btn =
  "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50";
export const channelBtn = btn;
export const channelBtnPrimary = `${btn} bg-accent text-white hover:bg-accent-hover`;
export const channelBtnSecondary = `${btn} bg-surface-hover text-foreground hover:bg-border`;
export const channelBtnDanger = `${btn} border border-error/30 text-error hover:bg-error/10`;
