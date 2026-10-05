/**
 * Etapa 6 (Quiz / funis interativos). Contrato compartilhado entre API,
 * MCP, editor e página pública. Browser-safe: só tipos e constantes.
 * A validação de verdade é o zod de lib/funnels/schema.ts.
 */

export const FUNNEL_STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
export type FunnelStatus = (typeof FUNNEL_STATUSES)[number];

export const FUNNEL_SCHEMA_VERSION = 1 as const;

export const BLOCK_TYPES = [
  "heading", "text", "image", "video", "button", "options", "field",
  "compare", "testimonial", "checklist", "countdown", "loading", "offer",
  "gallery", "faq", "spacer",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export type Align = "left" | "center";

type BlockBase = {
  /** Único no funil inteiro. Ex.: "b_k3j9x2". */
  id: string;
  /** Segundos até aparecer (0 a 600). Ex.: botão que surge depois da VSL. */
  delaySec?: number;
};

export type HeadingBlock = BlockBase & { type: "heading"; text: string; level?: 1 | 2; align?: Align };
/** Markdown mínimo: **negrito**, *itálico*, quebra de linha, "- " no início vira item. Variáveis {resposta.<name>}. */
export type TextBlock = BlockBase & { type: "text"; text: string; align?: Align; size?: "sm" | "md" | "lg" };
export type ImageBlock = BlockBase & {
  type: "image";
  url: string; // https, GIF aceito
  alt: string; // "" = decorativa
  width?: number;
  height?: number;
  rounded?: boolean;
};
export type VideoProvider = "youtube" | "vimeo" | "panda";
export type VideoBlock = BlockBase & {
  type: "video";
  /** URL como o dono colou (watch, youtu.be, shorts, embed, vimeo, panda embed). */
  url: string;
  /** Título acessível do iframe. */
  title: string;
  vertical?: boolean;
};

export type ButtonAction =
  | { kind: "next" }
  | { kind: "goto"; stepId: string }
  /** url vazia = usa settings.checkoutUrl. */
  | { kind: "checkout"; url?: string; newTab?: boolean };
export type ButtonBlock = BlockBase & {
  type: "button";
  label: string;
  action: ButtonAction;
  style?: "primary" | "secondary";
  pulse?: boolean;
  /** Fixo no rodapé (respeita safe-area). */
  sticky?: boolean;
};

export type FunnelOption = {
  id: string; // único dentro do bloco
  label: string;
  emoji?: string;
  imageUrl?: string;
  /** Etiqueta gravada no contato/lead quando escolhida (ex.: "quiz:nivel-zero"). */
  tag?: string;
  /** Tela de destino (só escolha única). Vazio = próxima. */
  goto?: string;
  /** Pontos somados pro roteamento do bloco loading. */
  score?: number;
};
export type OptionsBlock = BlockBase & {
  type: "options";
  /** Chave da resposta (variável {resposta.<name>}, coluna do CSV). [a-z0-9_-], única no funil. */
  name: string;
  question?: string;
  multiple: boolean;
  /** Padrão true. Múltipla exige ao menos minChoices (padrão 1). */
  required?: boolean;
  minChoices?: number;
  maxChoices?: number;
  layout?: "list" | "grid";
  /** Texto do botão Continuar (múltipla). Padrão "Continuar". */
  continueLabel?: string;
  options: FunnelOption[];
};

export const LEAD_FIELDS = ["name", "email", "whatsapp"] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];
export type FieldBlock = BlockBase & {
  type: "field";
  field: LeadField;
  label: string;
  placeholder?: string;
  required?: boolean;
};

export type CompareSide = { title: string; imageUrl?: string; items: string[] };
export type CompareBlock = BlockBase & {
  type: "compare";
  before: CompareSide;
  after: CompareSide;
  /** Dono confirma que é resultado real e autorizado. Exigido pra publicar quando há imagem. */
  authorized?: boolean;
};
export type TestimonialBlock = BlockBase & {
  type: "testimonial";
  quote: string;
  author: string;
  role?: string;
  imageUrl?: string;
  /** Exigido true pra publicar. */
  authorized: boolean;
};
export type ChecklistBlock = BlockBase & { type: "checklist"; title?: string; items: string[] };
export type CountdownBlock = BlockBase & {
  type: "countdown";
  /** ISO 8601 com fuso. Prazo REAL. Passou = o bloco some. */
  deadline: string;
  label: string;
};
export type ScoreRoute = { min?: number; max?: number; stepId: string };
export type LoadingBlock = BlockBase & {
  type: "loading";
  text: string;
  /** 1 a 8 s. Padrão 3. */
  durationSec?: number;
  /** Primeira faixa que casar com a soma de pontos decide a tela. Nenhuma = próxima. */
  routes?: ScoreRoute[];
};
export type OfferBlock = BlockBase & {
  type: "offer";
  title?: string;
  /** Centavos. null = falta preencher (bloqueia publicar). */
  priceCents: number | null;
  /** "De" só com preço cheio real. */
  compareAtCents?: number | null;
  /** Texto livre, ex.: "ou 12x de R$ 9,74". */
  installmentsText?: string;
  bonuses?: string[];
  guaranteeDays?: number | null;
  guaranteeText?: string;
  /** Ex.: "Esse preço vale até 10/10". Vazio = nada. Só prazo real. */
  deadlineText?: string;
};
export type GalleryBlock = BlockBase & { type: "gallery"; images: { url: string; alt: string }[] };
export type FaqBlock = BlockBase & { type: "faq"; items: { q: string; a: string }[] };
export type SpacerBlock = BlockBase & { type: "spacer"; size: "sm" | "md" | "lg" };

export type FunnelBlock =
  | HeadingBlock | TextBlock | ImageBlock | VideoBlock | ButtonBlock | OptionsBlock
  | FieldBlock | CompareBlock | TestimonialBlock | ChecklistBlock | CountdownBlock
  | LoadingBlock | OfferBlock | GalleryBlock | FaqBlock | SpacerBlock;

export type StepHeader = { showBack?: boolean; showProgress?: boolean; showLogo?: boolean };
export type FunnelStep = {
  id: string; // único no funil. Ex.: "s_capa"
  /** Nome interno (aparece em Resultados). */
  title: string;
  header?: StepHeader;
  blocks: FunnelBlock[];
};

export type FunnelTheme = {
  mode: "light" | "dark";
  /** #RRGGBB */
  primary: string;
  background: string;
  text: string;
  radius?: "sm" | "md" | "lg";
};
export type PixelConsent = "banner" | "notice";
export type FunnelSettings = {
  theme: FunnelTheme;
  logoUrl?: string;
  /** Checkout padrão dos botões kind:"checkout" sem url. https. */
  checkoutUrl?: string;
  /** Só dígitos (5 a 20). Vazio = sem Pixel. */
  pixelId?: string;
  /** banner (padrão) = Pixel só depois do "Aceitar"; notice = aviso informativo, Pixel carrega já. */
  pixelConsent?: PixelConsent;
  /** Dispara trackCustom("QuizStep") por tela. Padrão false. */
  pixelStepEvents?: boolean;
  seo?: { title?: string; description?: string; imageUrl?: string; indexable?: boolean };
  /** Link da política de privacidade usada no aviso LGPD. Padrão "/privacy". */
  privacyUrl?: string;
  /** Texto do checkbox de consentimento quando há campo de dados. */
  consentText?: string;
  footerText?: string;
};

export type FunnelDefinition = {
  schemaVersion: typeof FUNNEL_SCHEMA_VERSION;
  settings: FunnelSettings;
  steps: FunnelStep[];
};

// ─── Validação ───────────────────────────────────────────────────────────────
export const FUNNEL_ISSUE_CODES = [
  "no_steps", "duplicate_id", "duplicate_name", "goto_missing", "route_missing",
  "two_options_blocks", "dead_end", "checkout_no_url", "url_not_https", "video_not_allowed",
  "testimonial_not_authorized", "compare_not_authorized", "offer_no_price", "offer_compare_not_higher",
  "guarantee_no_days", "countdown_invalid", "countdown_past", "placeholder_left",
  "fields_without_privacy", "last_step_no_checkout", "low_contrast", "pixel_invalid",
  "options_empty", "loading_not_last_block", "checkout_unknown_host",
] as const;
export type FunnelIssueCode = (typeof FUNNEL_ISSUE_CODES)[number];
export type FunnelIssue = {
  code: FunnelIssueCode;
  level: "error" | "warning";
  stepId?: string;
  blockId?: string;
  params?: Record<string, string | number>;
};
export type FunnelValidation = { ok: boolean; errors: FunnelIssue[]; warnings: FunnelIssue[] };

// ─── Respostas da API do painel ─────────────────────────────────────────────
export type FunnelSummary = {
  id: string;
  name: string;
  slug: string;
  status: FunnelStatus;
  publishedVersion: number;
  publishedAt: string | null;
  hasUnpublishedChanges: boolean;
  stepCount: number;
  templateId: string | null;
  /** Caminho relativo: "/q/<slug>". */
  publicPath: string;
  createdAt: string;
  updatedAt: string;
  stats: { visits7d: number; checkouts7d: number; leads7d: number };
};
export type FunnelDetail = FunnelSummary & {
  draft: FunnelDefinition;
  published: FunnelDefinition | null;
  validation: FunnelValidation;
};

export type FunnelResults = {
  days: 7 | 30 | 90;
  source: string | null; // filtro utm_source aplicado
  totals: {
    visits: number;     // visitantes únicos
    started: number;    // passaram da 1ª tela ou responderam algo
    completed: number;  // chegaram na última tela
    checkouts: number;  // clicaram no checkout
    leads: number;
    purchases: number;  // compras aprovadas (webhook)
    refunds: number;
  };
  steps: { stepId: string; title: string; index: number; views: number; pctOfFirst: number; dropFromPrev: number }[];
  answers: { name: string; question: string; options: { id: string; label: string; count: number }[] }[];
  sources: { source: string; visits: number; checkouts: number; purchases: number }[];
};

export type FunnelLeadRow = {
  id: string;
  createdAt: string;
  name: string | null;
  email: string | null;
  whatsapp: string | null;
  answers: Record<string, string>; // name -> rótulos separados por ", "
  tags: string[];
  source: string | null;
  contactId: string | null;
  contactUsername: string | null;
  purchasedAt: string | null;
};
export type FunnelLeadsPage = { rows: FunnelLeadRow[]; nextCursor: string | null; total: number };

// ─── Página pública ─────────────────────────────────────────────────────────
/** Bloco já resolvido pro player: vídeo com embedUrl, checkout com url final (sem UTM). */
export type PublicBlock =
  | Exclude<FunnelBlock, VideoBlock | ButtonBlock>
  | (VideoBlock & { provider: VideoProvider; embedUrl: string })
  | (ButtonBlock & { checkoutUrl?: string });
export type PublicStep = Omit<FunnelStep, "blocks"> & { blocks: PublicBlock[] };
export type PublicFunnel = {
  id: string;
  slug: string;
  name: string;
  version: number; // publishedVersion (0 na prévia do rascunho)
  settings: FunnelSettings;
  steps: PublicStep[];
};

// ─── API pública ────────────────────────────────────────────────────────────
export const FUNNEL_EVENT_TYPES = ["view", "answer", "checkout", "complete"] as const;
export type FunnelEventType = (typeof FUNNEL_EVENT_TYPES)[number];
export type TrackingParams = Partial<Record<
  "utm_source" | "utm_medium" | "utm_campaign" | "utm_content" | "utm_term" | "fbclid" | "gclid" | "src" | "sck",
  string
>>;
export type FunnelEventBody = {
  visitorId: string;           // /^[a-f0-9]{32}$/
  version: number;
  type: FunnelEventType;
  stepId: string;
  blockId?: string;
  /** answer: ids das opções escolhidas. */
  optionIds?: string[];
  /** Só no 1º view: parâmetros da URL de entrada e token c. */
  tracking?: TrackingParams;
  contactToken?: string;
  referrer?: string;
} & FunnelAdSignals;
/**
 * Pixel/CAPI: o que o navegador sabe. adConsent = escolha no aviso de
 * cookies (sem escolha = não vai); fbp/fbc = cookies do Pixel; eventId = o
 * mesmo eventID do fbq (Lead, InitiateCheckout), pra Meta contar uma vez só.
 */
export type FunnelAdSignals = {
  adConsent?: "accepted" | "declined";
  fbp?: string;
  fbc?: string;
  eventId?: string;
};
export type FunnelLeadBody = {
  visitorId: string;
  version: number;
  stepId: string;
  fields: Partial<Record<LeadField, string>>;
  consent: boolean;
  /** Honeypot: tem de vir vazio. */
  website?: string;
} & FunnelAdSignals;
export type FunnelPublicOk = { ok: true; ignored?: boolean };
