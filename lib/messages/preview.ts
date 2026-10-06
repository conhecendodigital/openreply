/**
 * Preview text of a message in the conversation list (inbox screen and the
 * MCP listar_conversas), 2026-10-06.
 *
 * The Conversations API returns a button template DM (the campaign card)
 * with an EMPTY text, so the list showed "(sem texto)" exactly for the DMs
 * the owner most needs to recognise. We already have that message: the echo
 * webhook stored it with its template (DirectMessage.template, title = the
 * text inside the card), and the send ledger kept the text we sent
 * (OutboundMessage.text). Looked up by message id, never a Meta call.
 */
import { prisma } from "@/lib/db/client";

/** The text shown for a stored template: its title, else its first button. */
export function templatePreviewText(template: unknown): string | null {
  const t = template as { title?: unknown; subtitle?: unknown; buttons?: { title?: unknown }[] } | null;
  if (!t || typeof t !== "object") return null;
  const title = typeof t.title === "string" ? t.title.trim() : "";
  if (title) return title;
  const subtitle = typeof t.subtitle === "string" ? t.subtitle.trim() : "";
  if (subtitle) return subtitle;
  const button = t.buttons?.find((b) => typeof b?.title === "string" && b.title.trim());
  return button ? String(button.title).trim() : null;
}

/**
 * Text for the given message ids (only the blank ones need asking), from the
 * stored message (text, then template title) and then our send ledger. Never
 * throws: on any error the list just keeps its blanks.
 */
export async function previewTextsByMid(
  account: { id: string; instagramId: string },
  mids: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const wanted = [...new Set(mids.filter(Boolean))];
  if (wanted.length === 0) return out;
  try {
    const stored = await prisma.directMessage.findMany({
      where: { accountId: account.instagramId, mid: { in: wanted } },
      select: { mid: true, text: true, template: true },
    });
    for (const m of stored) {
      const text = m.text?.trim() || templatePreviewText(m.template);
      if (text) out.set(m.mid, text);
    }
    const missing = wanted.filter((mid) => !out.has(mid));
    if (missing.length > 0) {
      const sent = await prisma.outboundMessage.findMany({
        where: { instagramAccountId: account.id, mid: { in: missing } },
        select: { mid: true, text: true },
      });
      for (const m of sent) {
        if (m.mid && m.text?.trim()) out.set(m.mid, m.text.trim());
      }
    }
  } catch (err) {
    console.warn("[Inbox] Preview lookup failed:", err);
  }
  return out;
}
