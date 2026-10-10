/**
 * Mapas de funil da aba "Funis" (10/10/2026, referência do dono: o mapa de
 * funil com ícones das redes, páginas desenhadas, losangos de compra e setas
 * tracejadas pras mensagens de recuperação). Só dados: posição, tipo de
 * ícone, rótulo nos dois idiomas e qual número real vai em cada bloco.
 */
import type { BoardInput } from "@/lib/admin-funnels/board";

type Txt = { pt: string; en: string };

export type MapNodeKind =
  | "instagram"
  | "facebook"
  | "youtube"
  | "dm"
  | "whatsapp"
  | "email"
  | "page-quiz"
  | "page-sales"
  | "page-checkout"
  | "page-form"
  | "page-upsell"
  | "paid"
  | "pending"
  | "lost"
  | "call";

export type MapNode = {
  id: string;
  kind: MapNodeKind;
  label: Txt;
  x: number;
  y: number;
  /** Número real que aparece no bloco (só no mapa "Seu funil hoje"). */
  metric?: keyof BoardInput;
};

export type MapEdge = { from: string; to: string; dashed?: boolean; label?: Txt };

export type FunnelMap = { id: string; name: Txt; nodes: MapNode[]; edges: MapEdge[] };

const t = (pt: string, en: string): Txt => ({ pt, en });

export const FUNNEL_MAPS: FunnelMap[] = [
  {
    id: "hoje",
    name: t("Seu funil hoje", "Your funnel today"),
    nodes: [
      { id: "ig", kind: "instagram", label: t("Comentários no Instagram", "Instagram comments"), x: 0, y: 120, metric: "commented" },
      { id: "dm", kind: "dm", label: t("DM com o link", "DM with the link"), x: 200, y: 120, metric: "received" },
      { id: "quiz", kind: "page-quiz", label: t("Quiz", "Quiz"), x: 400, y: 70, metric: "quizVisits" },
      { id: "oferta", kind: "page-checkout", label: t("Oferta e checkout", "Offer and checkout"), x: 640, y: 70, metric: "checkouts" },
      { id: "paid", kind: "paid", label: t("Compra aprovada", "Purchase approved"), x: 900, y: 20, metric: "purchases" },
      { id: "lost", kind: "lost", label: t("Não comprou", "Didn't buy"), x: 900, y: 200 },
      { id: "wa1", kind: "whatsapp", label: t("WhatsApp", "WhatsApp"), x: 1080, y: 200 },
      { id: "wa2", kind: "whatsapp", label: t("WhatsApp", "WhatsApp"), x: 1220, y: 200 },
    ],
    edges: [
      { from: "ig", to: "dm" },
      { from: "dm", to: "quiz", label: t("clicou", "clicked") },
      { from: "quiz", to: "oferta" },
      { from: "oferta", to: "paid" },
      { from: "oferta", to: "lost" },
      { from: "lost", to: "wa1", dashed: true },
      { from: "wa1", to: "wa2", dashed: true },
    ],
  },
  {
    id: "aplicacao",
    name: t("Aplicação pra serviço ou ticket alto", "Application for a service or high ticket"),
    nodes: [
      { id: "ig", kind: "instagram", label: t("Post com dor de negócio", "Post about a business pain"), x: 0, y: 40 },
      { id: "yt", kind: "youtube", label: t("Vídeo no YouTube", "YouTube video"), x: 0, y: 220 },
      { id: "dm", kind: "dm", label: t("DM em conversa", "Conversational DM"), x: 200, y: 40 },
      { id: "form", kind: "page-form", label: t("4 perguntas de qualificação", "4 qualifying questions"), x: 400, y: 100 },
      { id: "wa", kind: "whatsapp", label: t("Agente de WhatsApp qualifica", "WhatsApp agent qualifies"), x: 650, y: 100 },
      { id: "call", kind: "call", label: t("Call de fechamento", "Closing call"), x: 850, y: 30 },
      { id: "paid", kind: "paid", label: t("Venda fechada", "Deal closed"), x: 1050, y: 30 },
      { id: "lost", kind: "lost", label: t("Não qualificou", "Not qualified"), x: 850, y: 220 },
      { id: "sales", kind: "page-sales", label: t("Curso de entrada", "Entry course"), x: 1030, y: 190 },
    ],
    edges: [
      { from: "ig", to: "dm" },
      { from: "yt", to: "form" },
      { from: "dm", to: "form" },
      { from: "form", to: "wa" },
      { from: "wa", to: "call" },
      { from: "call", to: "paid" },
      { from: "wa", to: "lost" },
      { from: "lost", to: "sales", dashed: true },
    ],
  },
  {
    id: "quiz-oferta",
    name: t("Quiz até a oferta (ticket baixo)", "Quiz to offer (low ticket)"),
    nodes: [
      { id: "ig", kind: "instagram", label: t("Instagram", "Instagram"), x: 0, y: 40 },
      { id: "fb", kind: "facebook", label: t("Anúncio", "Ad"), x: 0, y: 200 },
      { id: "quiz", kind: "page-quiz", label: t("3 perguntas e o WhatsApp", "3 questions and the WhatsApp"), x: 200, y: 80 },
      { id: "sales", kind: "page-sales", label: t("Resultado e oferta por perfil", "Result and offer per profile"), x: 440, y: 80 },
      { id: "checkout", kind: "page-checkout", label: t("Checkout", "Checkout"), x: 680, y: 80 },
      { id: "paid", kind: "paid", label: t("Compra aprovada", "Purchase approved"), x: 920, y: 20 },
      { id: "pending", kind: "pending", label: t("Pix ou boleto gerado", "Pix or boleto generated"), x: 920, y: 200 },
      { id: "up", kind: "page-upsell", label: t("Oferta seguinte", "Next offer"), x: 1100, y: 0 },
      { id: "wa1", kind: "whatsapp", label: t("Lembrete 1 h", "Reminder 1 h"), x: 760, y: 340 },
      { id: "wa2", kind: "whatsapp", label: t("Lembrete 24 h", "Reminder 24 h"), x: 600, y: 340 },
    ],
    edges: [
      { from: "ig", to: "quiz" },
      { from: "fb", to: "quiz" },
      { from: "quiz", to: "sales" },
      { from: "sales", to: "checkout" },
      { from: "checkout", to: "paid" },
      { from: "checkout", to: "pending" },
      { from: "paid", to: "up" },
      { from: "pending", to: "wa1", dashed: true },
      { from: "wa1", to: "wa2", dashed: true },
      { from: "wa2", to: "sales", dashed: true },
    ],
  },
  {
    id: "recuperacao",
    name: t("Recuperação de quem clicou e não comprou", "Recover people who clicked and didn't buy"),
    nodes: [
      { id: "lost", kind: "lost", label: t("Clicou e não comprou", "Clicked and didn't buy"), x: 0, y: 100 },
      { id: "dm", kind: "dm", label: t("Pergunta: o que faltou?", "Question: what was missing?"), x: 220, y: 100 },
      { id: "wa", kind: "whatsapp", label: t("Resposta a cada objeção", "Answer each objection"), x: 440, y: 100 },
      { id: "checkout", kind: "page-checkout", label: t("Volta pro checkout", "Back to checkout"), x: 660, y: 60 },
      { id: "paid", kind: "paid", label: t("Compra aprovada", "Purchase approved"), x: 900, y: 100 },
    ],
    edges: [
      { from: "lost", to: "dm" },
      { from: "dm", to: "wa", dashed: true },
      { from: "wa", to: "checkout" },
      { from: "checkout", to: "paid" },
    ],
  },
  {
    id: "lista-espera",
    name: t("Teste de demanda (lista de espera)", "Demand test (waitlist)"),
    nodes: [
      { id: "ig", kind: "instagram", label: t("Post com antes e depois", "Before and after post"), x: 0, y: 100 },
      { id: "dm", kind: "dm", label: t("Palavra-chave entra na lista", "Keyword joins the list"), x: 220, y: 100 },
      { id: "form", kind: "page-form", label: t("Quanto pagaria e pra quê", "What they'd pay and why"), x: 440, y: 60 },
      { id: "wa", kind: "whatsapp", label: t("Aviso do lançamento", "Launch notice"), x: 700, y: 100 },
      { id: "sales", kind: "page-sales", label: t("Página de venda", "Sales page"), x: 900, y: 60 },
    ],
    edges: [
      { from: "ig", to: "dm" },
      { from: "dm", to: "form" },
      { from: "form", to: "wa", dashed: true },
      { from: "wa", to: "sales" },
    ],
  },
];

export const mapText = (txt: Txt, lang: "pt" | "en") => txt[lang] ?? txt.pt;
