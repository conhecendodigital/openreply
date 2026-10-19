/**
 * Gatilhos por frase (2026-10-17, pedido do dono): quando o contato manda a
 * frase combinada pra um número, o Lead Engine responde sozinho com as
 * mensagens prontas. Primeiro uso: o quiz "aula-chat-sem-frescura" tem um
 * botão que abre o WhatsApp do número Automação com "Quero a aula do
 * workshop" já escrito; a pessoa envia, a janela de 24 h abre e sai o link da
 * aula + o convite pro Chat Sem Frescura.
 *
 * A regra das 24 h continua valendo (enqueuePlanned): só responde porque a
 * própria pessoa acabou de mandar mensagem. Nada sai pra quem não escreveu.
 * Mesma frase da mesma conversa no mesmo dia = um envio só (jobId fixo).
 */
import { enqueuePlanned, type EnqueueDeps, type EnqueueResult } from "@/lib/whatsapp/outbound";
import type { BubblePlan } from "@/lib/whatsapp/pacing";

export interface Gatilho {
  id: string;
  /** Número (WaSession.id) que escuta a frase. */
  sessionId: string;
  /** Frases que disparam (comparadas sem acento, caixa e pontuação). */
  frases: string[];
  /** Mensagens na ordem. {nome} vira o primeiro nome do WhatsApp (ou some). */
  mensagens: string[];
}

const AULA_LINK = "https://drive.google.com/file/d/1G1rrU1rmOQdUoXJ4Oz9tpYYERS9_EauD/view?usp=drivesdk";

export const GATILHOS: Gatilho[] = [
  {
    id: "aula-csf",
    sessionId: "cmuzxviv605kk23nz4j1d99s3", // número "Automacao" (+55 77 9852-9874)
    frases: ["quero a aula do workshop"],
    mensagens: [
      `Oi{nome}! Aqui é o Matheus. Tá aqui a aula do workshop de quinta, gravada inteira:\n${AULA_LINK}`,
      "Se a aula te ajudar, o Chat Sem Frescura leva isso mais longe: as Habilidades prontas, o Comandos Pro e o grupo no WhatsApp comigo. Está R$97 (ou 12x de R$10,03) e tem 7 dias de garantia. Quer que eu te mande o link?",
    ],
  },
];

export function normalizarFrase(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function acharGatilho(sessionId: string, body: string | null | undefined, lista: Gatilho[] = GATILHOS): Gatilho | null {
  if (!body) return null;
  const texto = normalizarFrase(body);
  if (!texto) return null;
  return lista.find((g) => g.sessionId === sessionId && g.frases.some((f) => texto.includes(normalizarFrase(f)))) ?? null;
}

export function primeiroNome(pushName: string | null | undefined): string {
  const n = (pushName ?? "").trim().split(/\s+/)[0] ?? "";
  return /^[\p{L}][\p{L}'-]{0,29}$/u.test(n) ? n : "";
}

export function montarMensagens(g: Gatilho, pushName: string | null | undefined): string[] {
  const nome = primeiroNome(pushName);
  return g.mensagens.map((m) => m.replace("{nome}", nome ? `, ${nome}` : ""));
}

/** Pausa de pessoa: lê, digita a 1ª; espera ~20 s e digita a 2ª. */
export function planoDoGatilho(textos: string[], rand: () => number = Math.random): BubblePlan[] {
  return textos.map((text, i) => ({
    text,
    waitBeforeTypingMs: Math.round((i === 0 ? 3_000 : 18_000) + 4_000 * rand()),
    typingMs: Math.round(2_500 + 2_500 * rand()),
  }));
}

function diaUtc(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Roda no gancho de mensagem nova do contato. Devolve null quando não é gatilho. */
export async function responderGatilho(
  info: { ownerUserId: string; sessionId: string; conversationId: string; body?: string | null },
  deps: Pick<EnqueueDeps, "repo" | "queue" | "now">,
  lista: Gatilho[] = GATILHOS
): Promise<{ gatilho: string; result: EnqueueResult } | null> {
  const g = acharGatilho(info.sessionId, info.body, lista);
  if (!g) return null;
  const conv = await deps.repo.getConversation(info.conversationId);
  if (!conv) return null;
  const contato = await deps.repo.getContact(conv.contactId);
  const textos = montarMensagens(g, contato?.pushName);
  const now = (deps.now ?? Date.now)();
  const result = await enqueuePlanned(
    { ownerUserId: info.ownerUserId, sessionId: info.sessionId, conversationId: info.conversationId, sentBy: "AGENT", content: { type: "text", text: textos.join("\n\n") } },
    planoDoGatilho(textos),
    deps,
    { outboxId: `gatilho_${g.id}_${info.conversationId}_${diaUtc(now)}` }
  );
  return { gatilho: g.id, result };
}
