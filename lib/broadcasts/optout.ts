/**
 * Opt-out of broadcasts: a DM that is exactly PARAR, SAIR or STOP (any case,
 * accents, spaces and punctuation around it ignored) sets
 * Contact.broadcastOptOutAt, tags "saiu:disparos" and writes OPT_OUT on the
 * timeline. It only excludes the person from FUTURE broadcasts (and the ones
 * still sending, checked before each send): campaigns and flows keep
 * answering the word exactly as before. No automatic reply (that would be an
 * automatic send). Idempotent; never throws.
 */
import { prisma } from "@/lib/db/client";
import { AUTO_TAGS, addTag, recordEvent, type ContactRef } from "@/lib/contacts/record";

export const OPT_OUT_WORDS: ReadonlySet<string> = new Set(["PARAR", "SAIR", "STOP"]);

export function normalizeOptOutText(text: string | null | undefined): string {
  return (text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toUpperCase();
}

export function isOptOutText(text: string | null | undefined): boolean {
  return OPT_OUT_WORDS.has(normalizeOptOutText(text));
}

export async function recordOptOut(
  contact: ContactRef,
  input: { text: string | null | undefined; mid: string; at: Date }
): Promise<boolean> {
  if (!isOptOutText(input.text)) return false;
  try {
    const { count } = await prisma.contact.updateMany({
      where: { id: contact.id, broadcastOptOutAt: null },
      data: { broadcastOptOutAt: input.at },
    });
    await addTag(contact, AUTO_TAGS.optedOut, "auto", input.at);
    await recordEvent(contact, {
      type: "OPT_OUT",
      refId: input.mid,
      occurredAt: input.at,
      text: normalizeOptOutText(input.text),
    });
    return count > 0;
  } catch (error) {
    console.warn("[Broadcasts] opt-out not recorded:", error instanceof Error ? error.message : error);
    return false;
  }
}
