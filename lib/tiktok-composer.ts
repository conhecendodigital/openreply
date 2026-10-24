/**
 * 23/10/2026: regras do compositor de post do TikTok (aba Posts).
 * Lógica pura, sem importar servidor: privacidade, conteúdo comercial,
 * duração, declaração e horário. A tela só mostra o que estas funções dizem.
 * As regras seguem as diretrizes de UX do Direct Post do TikTok.
 */

export type PrivacyLevel =
  | "PUBLIC_TO_EVERYONE"
  | "MUTUAL_FOLLOW_FRIENDS"
  | "FOLLOWER_OF_CREATOR"
  | "SELF_ONLY";

export const PRIVACY_LABELS: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};

export const CAPTION_MAX = 2200;
export const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
/** Brasília não tem horário de verão desde 2019: UTC-3 fixo. */
export const BRASILIA_OFFSET = "-03:00";

export interface TikTokSettings {
  privacyLevel: string;
  allowComment: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  commercial: { enabled: boolean; yourBrand: boolean; brandedContent: boolean };
  isAigc: boolean;
}

export type PostStatus = "DRAFT" | "SCHEDULED" | "PUBLISHING" | "PUBLISHED" | "FAILED" | "CANCELED";

export type PostNetwork = "TIKTOK" | "YOUTUBE" | "INSTAGRAM" | "FACEBOOK";

export interface SocialAccountDTO {
  id: string;
  /** De qual tabela vem a conta: "social" (TikTok, YouTube) ou "channel" (Instagram, Facebook). */
  source: "social" | "channel";
  platform: PostNetwork;
  displayName: string;
  username: string | null;
  avatarUrl: string | null;
  status: "ACTIVE" | "NEEDS_RECONNECT" | "DISCONNECTED";
  tokenExpiresAt: string | null;
  connectedAt: string;
  lastError: string | null;
  /** Só contas "social" se desconectam pela aba Posts; Instagram e Facebook, em Canais. */
  canDisconnect: boolean;
  /** Permissões concedidas pela pessoa (contas "social"). */
  scopes: string[];
  /** YouTube: permissões pedidas que a pessoa não concedeu. */
  missingScopes: string[];
}

export interface CreatorInfo {
  nickname: string;
  username: string;
  avatarUrl: string | null;
  privacyLevelOptions: string[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
}

export interface PostDTO {
  id: string;
  platform: PostNetwork;
  /** Id da conta, venha da tabela que vier. */
  accountId: string;
  socialAccountId: string | null;
  channelId: string | null;
  accountName: string;
  status: PostStatus;
  caption: string;
  mediaUrl: string;
  mediaBytes: number;
  mediaContentType: string;
  /** Opções da rede do post (TikTokSettings, YouTube, Instagram ou Facebook). */
  settings: Record<string, unknown>;
  scheduledAt: string | null;
  publishedAt: string | null;
  /** Endereço do post no ar, quando a rede dá um (YouTube, Facebook). */
  externalUrl: string | null;
  lastError: string | null;
  createdVia: "UI" | "MCP" | "API";
  createdAt: string;
  updatedAt: string;
}

/** Tudo desligado e sem privacidade escolhida: a pessoa precisa escolher. */
export function emptySettings(): TikTokSettings {
  return {
    privacyLevel: "",
    allowComment: false,
    allowDuet: false,
    allowStitch: false,
    commercial: { enabled: false, yourBrand: false, brandedContent: false },
    isAigc: false,
  };
}

/** Privacidades que a pessoa pode escolher. Conteúdo de marca não pode ser "Só eu". */
export function availablePrivacyOptions(options: string[], brandedContent: boolean): string[] {
  return brandedContent ? options.filter((o) => o !== "SELF_ONLY") : options;
}

export type Disclosure = "music" | "branded";

/**
 * Qual declaração aparece perto dos botões. Conteúdo de marca: política de
 * conteúdo de marca + música. Todo o resto (só Sua marca, ou comercial desligado):
 * a Confirmação de Uso de Música, que o TikTok pede em qualquer publicação.
 */
export function disclosureKind(c: TikTokSettings["commercial"]): Disclosure {
  return c.enabled && c.brandedContent ? "branded" : "music";
}

/** Mexer num dado do compositor mantendo as regras: marca e privacidade, interação bloqueada. */
export function normalizeSettings(s: TikTokSettings, info: CreatorInfo | null): TikTokSettings {
  const next: TikTokSettings = { ...s, commercial: { ...s.commercial } };
  if (!next.commercial.enabled) {
    next.commercial.yourBrand = false;
    next.commercial.brandedContent = false;
  }
  if (next.commercial.enabled && next.commercial.brandedContent && next.privacyLevel === "SELF_ONLY") {
    next.privacyLevel = "";
  }
  if (info) {
    if (info.commentDisabled) next.allowComment = false;
    if (info.duetDisabled) next.allowDuet = false;
    if (info.stitchDisabled) next.allowStitch = false;
    if (next.privacyLevel && !info.privacyLevelOptions.includes(next.privacyLevel)) next.privacyLevel = "";
  }
  return next;
}

/** "2026-10-24T14:30" (horário de Brasília) → ISO em UTC. null se inválido. */
export function brasiliaLocalToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const d = new Date(`${local}:00${BRASILIA_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO em UTC → "YYYY-MM-DDTHH:mm" no horário de Brasília (para o datetime-local). */
export function isoToBrasiliaLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 16);
}

export interface ComposerInput {
  accountId: string;
  caption: string;
  mediaUrl: string;
  mediaContentType: string;
  /** Duração lida do vídeo no navegador, em segundos. null = ainda não leu. */
  durationSec: number | null;
  settings: TikTokSettings;
  /** Só quando for agendar. */
  scheduledLocal?: string;
}

export type ComposerAction = "draft" | "schedule" | "publish";

/** Mensagens em inglês: a tela passa cada uma por t(). Lista vazia = pode seguir. */
export function validateComposer(
  input: ComposerInput,
  info: CreatorInfo | null,
  action: ComposerAction,
  now: Date = new Date()
): string[] {
  const errors: string[] = [];
  if (!input.accountId) errors.push("Pick the TikTok account.");
  if (!input.mediaUrl) errors.push("Add the video.");
  if (input.caption.length > CAPTION_MAX) errors.push("The caption is too long.");
  if (action === "draft") return errors;

  const s = input.settings;
  if (!info) errors.push("Wait for the account details to load.");
  if (!s.privacyLevel) {
    errors.push("Choose who can see the video.");
  } else if (info && !info.privacyLevelOptions.includes(s.privacyLevel)) {
    errors.push("That privacy option is not available for this account.");
  }
  if (s.commercial.enabled && !s.commercial.yourBrand && !s.commercial.brandedContent) {
    errors.push("Pick Your brand or Branded content.");
  }
  if (s.commercial.enabled && s.commercial.brandedContent && s.privacyLevel === "SELF_ONLY") {
    errors.push("Branded content can't be private.");
  }
  if (info && input.durationSec != null && input.durationSec > info.maxVideoPostDurationSec) {
    errors.push("The video is longer than this account allows.");
  }
  if (action === "schedule") {
    const iso = brasiliaLocalToIso(input.scheduledLocal ?? "");
    if (!iso) errors.push("Pick the date and time.");
    else if (new Date(iso).getTime() <= now.getTime()) errors.push("Pick a time in the future.");
  }
  return errors;
}

/** Só o essencial do arquivo escolhido: tipo aceito. */
export function isAllowedVideoType(type: string): boolean {
  return ALLOWED_VIDEO_TYPES.includes(type);
}

/** "12 MB" simples para a tela. */
export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
