/**
 * What a human (or the vendedor) needs to answer one person: the last DMs from
 * the stored inbox history (DirectMessage, written inline by the webhook, so
 * it is never behind the CRM), the window and the takeover state.
 */
import { prisma } from "@/lib/db/client";
import { isTakeoverActive } from "@/lib/messaging/takeover";
import { messagePreviewText } from "@/lib/dm/message-preview";
import { windowClosesAt, windowRemainingMs } from "@/lib/messaging/window";

export type ContextContact = {
  id: string;
  igUserId: string;
  username: string | null;
  name: string | null;
  profilePicUrl?: string | null;
  instagramAccountId?: string;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  humanTakeover: boolean;
  humanTakeoverUntil: Date | null;
  humanTakeoverReason?: string | null;
  notes?: string | null;
  instagramAccount: { instagramId: string; username: string };
  tags: { name: string }[];
};

export const CONTEXT_CONTACT_SELECT = {
  id: true,
  igUserId: true,
  username: true,
  name: true,
  profilePicUrl: true,
  instagramAccountId: true,
  lastInboundAt: true,
  lastOutboundAt: true,
  humanTakeover: true,
  humanTakeoverUntil: true,
  humanTakeoverReason: true,
  notes: true,
  instagramAccount: { select: { instagramId: true, username: true } },
  tags: { select: { name: true }, orderBy: { createdAt: "asc" } },
} as const;

/**
 * Quem escreveu (28/10/2026). Sem isso, o cartão de um fluxo nosso ou o rótulo
 * "📷 Foto" parecia fala da pessoa, e o vendedor respondia ao que ninguém disse.
 *  person: a pessoa. flow: nosso fluxo, campanha, sequência ou follow-up (cartão ou texto automático).
 *  vendedor: rascunho/mensagem do nosso vendedor (IA). owner_app: você, pela tela do Lead Engine.
 *  owner_phone: você, pelo celular (eco que não saiu do Lead Engine).
 */
export const SPEAKERS = ["person", "flow", "vendedor", "owner_app", "owner_phone", "us"] as const;
export type Speaker = (typeof SPEAKERS)[number];

export const SPEAKER_LABELS: Record<Speaker, string> = {
  person: "A PESSOA",
  flow: "NOSSO FLUXO (automático, não é a pessoa)",
  vendedor: "NOSSO VENDEDOR (IA)",
  owner_app: "VOCÊ (pelo Lead Engine)",
  owner_phone: "VOCÊ (pelo celular)",
  us: "NOSSA (origem não conferida)",
};

/** O que a mensagem é: texto escrito, cartão com botões, anexo (foto, áudio...) ou apagada. */
export type MessageKind = "text" | "card" | "attachment" | "story" | "deleted";

const FLOW_ORIGINS = new Set(["automation", "followup", "sequence", "private_reply", "flow", "broadcast"]);

export function classifySpeaker(
  fromMe: boolean,
  ledger: { origin: string; refId?: string | null } | null | undefined,
  draftOrigin?: string | null
): Speaker {
  if (!fromMe) return "person";
  if (!ledger) return "owner_phone";
  if (FLOW_ORIGINS.has(ledger.origin)) return "flow";
  if (ledger.origin === "draft") return draftOrigin === "vendedor" ? "vendedor" : "owner_app";
  if (ledger.origin === "vendedor_auto") return "vendedor";
  if (ledger.origin === "inbox") return "owner_app";
  return "flow";
}

export type StoredMessage = {
  mid: string;
  fromMe: boolean;
  /** Quem escreveu. Leia isto antes do texto. */
  speaker: Speaker;
  speakerLabel: string;
  kind: MessageKind;
  /** Cartão repetido: quantas vezes o mesmo cartão foi mandado em seguida (1 = uma vez). */
  repeated: number;
  /** Raw text, or the card's title for a button card (never the media label). */
  text: string | null;
  /** What a human reads: text, card + buttons, or a label like "📷 Foto". Never empty. */
  preview: string;
  sentAt: Date;
  storyReply: boolean;
  storyKind: string | null;
};

function templateTitle(template: unknown): string | null {
  const t = template as { title?: unknown } | null;
  return t && typeof t.title === "string" && t.title.trim() ? t.title.trim() : null;
}

/** Padrão de mensagens lidas (28/10/2026: 5 era pouco pra entender a conversa). */
export const DEFAULT_LAST_MESSAGES = 12;

function kindOf(r: { deleted?: boolean; text: string | null; template: unknown; storyReply: boolean; storyKind: string | null }): MessageKind {
  if (r.deleted) return "deleted";
  if (r.text?.trim()) return r.storyReply || r.storyKind ? "story" : "text";
  if (r.template && templateTitle(r.template)) return "card";
  if (r.template) return "card";
  if (r.storyReply || r.storyKind) return "story";
  return "attachment";
}

/** Cartões idênticos em sequência (mesmo autor) viram um só com "repeated". */
export function collapseRepeatedCards(list: StoredMessage[]): StoredMessage[] {
  const out: StoredMessage[] = [];
  for (const m of list) {
    const prev = out[out.length - 1];
    if (prev && m.kind === "card" && prev.kind === "card" && prev.speaker === m.speaker && prev.preview === m.preview) {
      prev.repeated += m.repeated;
      prev.mid = m.mid;
      prev.sentAt = m.sentAt;
      continue;
    }
    out.push({ ...m });
  }
  return out;
}

export async function lastMessages(
  instagramId: string,
  igUserId: string,
  take = DEFAULT_LAST_MESSAGES
): Promise<StoredMessage[]> {
  const rows = await prisma.directMessage.findMany({
    where: { accountId: instagramId, contactId: igUserId, deleted: false },
    orderBy: { sentAt: "desc" },
    take,
    select: {
      mid: true,
      fromMe: true,
      text: true,
      template: true,
      sentAt: true,
      storyReply: true,
      storyKind: true,
      attachmentKinds: true,
      media: { select: { type: true } },
    },
  });
  // Quem mandou cada uma das nossas: o ledger (OutboundMessage) sabe a origem; sem linha nele, foi você pelo celular.
  let ledgerOk = false;
  const ledgerByMid = new Map<string, { origin: string; refId: string | null }>();
  const draftOrigin = new Map<string, string>();
  try {
    const ours = rows.filter((r) => r.fromMe).map((r) => r.mid);
    if (ours.length === 0) ledgerOk = true;
    else {
      const led = await prisma.outboundMessage.findMany({ where: { mid: { in: ours } }, select: { mid: true, origin: true, refId: true } });
      ledgerOk = true;
      for (const l of led ?? []) if (l.mid) ledgerByMid.set(l.mid, { origin: l.origin, refId: l.refId ?? null });
      const draftIds = [...new Set([...ledgerByMid.values()].filter((l) => l.origin === "draft" && l.refId).map((l) => l.refId as string))];
      if (draftIds.length > 0) {
        const drafts = await prisma.draftReply.findMany({ where: { id: { in: draftIds } }, select: { id: true, origin: true } });
        for (const d of drafts ?? []) draftOrigin.set(d.id, d.origin);
      }
    }
  } catch {
    // Sem ledger a gente não chuta: mensagem nossa sem origem fica "você pelo celular" só se o ledger respondeu vazio.
  }
  const mapped = rows.reverse().map((r) => {
    const preview = messagePreviewText({ ...r, deleted: false });
    const cardTitle = r.template ? templateTitle(r.template) : null;
    const ledger = ledgerByMid.get(r.mid) ?? null;
    const speaker: Speaker =
      r.fromMe && !ledger && !ledgerOk ? "us" : classifySpeaker(r.fromMe, ledger, ledger?.refId ? draftOrigin.get(ledger.refId) : null);
    return {
      mid: r.mid,
      fromMe: r.fromMe,
      speaker,
      speakerLabel: SPEAKER_LABELS[speaker],
      kind: kindOf(r),
      repeated: 1,
      text: r.text?.trim() ? r.text : cardTitle,
      preview,
      sentAt: r.sentAt,
      storyReply: r.storyReply,
      storyKind: r.storyKind ?? null,
    } satisfies StoredMessage;
  });
  return collapseRepeatedCards(mapped);
}

export function describeWindow(contact: { lastInboundAt: Date | null }, now: Date = new Date()) {
  const remainingMs = windowRemainingMs(contact, now);
  return {
    open: remainingMs > 0,
    closesAt: windowClosesAt(contact),
    hoursLeft: Math.round((remainingMs / 3_600_000) * 10) / 10,
  };
}

export function describeTakeover(contact: Pick<ContextContact, "humanTakeover" | "humanTakeoverUntil" | "humanTakeoverReason">, now: Date = new Date()) {
  const active = isTakeoverActive(contact, now);
  return {
    active,
    until: active ? contact.humanTakeoverUntil : null,
    reason: active ? contact.humanTakeoverReason ?? null : null,
  };
}

export async function presentContact(contact: ContextContact, options: { messages?: number; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const messages = await lastMessages(contact.instagramAccount.instagramId, contact.igUserId, options.messages ?? DEFAULT_LAST_MESSAGES);
  return {
    id: contact.id,
    igUserId: contact.igUserId,
    username: contact.username,
    name: contact.name,
    // Photo (Meta link, expires) and the account, for the "open conversation"
    // link when there is no @ yet.
    profilePicUrl: contact.profilePicUrl ?? null,
    instagramAccountId: contact.instagramAccountId ?? null,
    tags: contact.tags.map((t) => t.name),
    notes: contact.notes ?? null,
    lastInboundAt: contact.lastInboundAt,
    lastOutboundAt: contact.lastOutboundAt,
    window: describeWindow(contact, now),
    takeover: describeTakeover(contact, now),
    lastMessages: messages,
  };
}
