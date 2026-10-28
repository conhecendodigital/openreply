import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  prisma: {
    directMessage: { findMany: vi.fn(async (): Promise<unknown[]> => []) },
    outboundMessage: { findMany: vi.fn(async (): Promise<unknown[]> => []) },
  },
}));
vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));

import {
  conversationPreviewText,
  EMPTY_CONVERSATION_PREVIEW,
  messagePreviewText,
  templatePreview,
  UNKNOWN_MESSAGE_PREVIEW,
} from "../lib/dm/message-preview";
import { parseDirectMessages } from "../lib/messages/parse";
import { lastMessages } from "../lib/inbox/context";
import { previewTextsByMid } from "../lib/messages/preview";

describe("messagePreviewText", () => {
  it("returns normal text, trimmed", () => {
    expect(messagePreviewText({ text: "  oi, tudo bem?  " })).toBe("oi, tudo bem?");
  });

  it("shows a card as title + buttons", () => {
    const template = { title: "Opa, tudo bem?", buttons: [{ title: "Quero outro Comando" }, { title: "Ver mais" }] };
    expect(messagePreviewText({ text: null, template })).toBe("Opa, tudo bem? [botões: Quero outro Comando | Ver mais]");
  });

  it("shows a card without buttons as just the title", () => {
    expect(messagePreviewText({ template: { title: "Só texto", buttons: [] } })).toBe("Só texto");
    expect(messagePreviewText({ template: { title: "Só texto" } })).toBe("Só texto");
  });

  it("falls back to subtitle, and to buttons only", () => {
    expect(templatePreview({ subtitle: "sub", buttons: [{ title: "A" }] })).toBe("sub [botões: A]");
    expect(templatePreview({ buttons: [{ title: "A" }] })).toBe("[botões: A]");
    expect(templatePreview({})).toBeNull();
    expect(templatePreview(null)).toBeNull();
    expect(templatePreview("lixo")).toBeNull();
  });

  it.each([
    ["image", "📷 Foto"],
    ["video", "🎬 Vídeo"],
    ["audio", "🎤 Áudio"],
    ["share", "🔗 Compartilhou um post"],
    ["reel", "🔗 Compartilhou um reel"],
    ["ig_reel", "🔗 Compartilhou um reel"],
    ["file", "📎 Arquivo"],
    ["story_mention", "📖 Mencionou você num story"],
  ])("labels a %s attachment (media row)", (type, label) => {
    expect(messagePreviewText({ text: "", media: [{ type }] })).toBe(label);
  });

  it("labels attachments with no media row via attachmentKinds (ephemeral)", () => {
    expect(messagePreviewText({ text: null, media: [], attachmentKinds: ["image"] })).toBe("📷 Foto");
  });

  it("labels story reply by direction and a mention", () => {
    expect(messagePreviewText({ storyReply: true, fromMe: false })).toBe("↩️ Respondeu ao seu story");
    expect(messagePreviewText({ storyReply: true, fromMe: true })).toBe("↩️ Você respondeu ao story");
    expect(messagePreviewText({ storyReply: true, storyKind: "mention" })).toBe("📖 Mencionou você num story");
  });

  it("labels reactions and deleted messages", () => {
    expect(messagePreviewText({ reaction: true })).toBe("❤️ Reação");
    expect(messagePreviewText({ reaction: "😍" })).toBe("❤️ Reação 😍");
    expect(messagePreviewText({ text: "oi", deleted: true })).toBe("🚫 Mensagem apagada");
  });

  it("uses the generic line for unknown or unsupported", () => {
    expect(messagePreviewText({ text: null })).toBe(UNKNOWN_MESSAGE_PREVIEW);
    expect(messagePreviewText({ attachmentKinds: ["unsupported"] })).toBe(UNKNOWN_MESSAGE_PREVIEW);
    expect(messagePreviewText({ media: [{ type: "coisa_nova" }] })).toBe(UNKNOWN_MESSAGE_PREVIEW);
  });

  it("handles null and undefined without throwing", () => {
    expect(messagePreviewText(null)).toBe(EMPTY_CONVERSATION_PREVIEW);
    expect(messagePreviewText(undefined)).toBe(EMPTY_CONVERSATION_PREVIEW);
    expect(messagePreviewText({ media: null, attachmentKinds: null, template: undefined })).toBe(UNKNOWN_MESSAGE_PREVIEW);
  });

  it("cuts long text only in the preview", () => {
    const long = "a".repeat(500);
    const out = messagePreviewText({ text: long }, 50);
    expect(Array.from(out)).toHaveLength(50);
    expect(out.endsWith("…")).toBe(true);
    expect(long).toHaveLength(500);
    expect(messagePreviewText({ text: "curto" }, 50)).toBe("curto");
  });

  it("conversation list: null last message -> Sem mensagens ainda", () => {
    expect(conversationPreviewText(null)).toBe("Sem mensagens ainda");
    expect(conversationPreviewText({ text: "oi" })).toBe("oi");
  });
});

describe("parseDirectMessages keeps attachment kinds", () => {
  const ACC = "1784";
  const wrap = (message: unknown) => ({
    object: "instagram",
    entry: [{ id: ACC, time: 1, messaging: [{ sender: { id: "9" }, recipient: { id: ACC }, timestamp: 1, message }] }],
  });

  it("records the type of an ephemeral attachment with no URL", () => {
    const [m] = parseDirectMessages(wrap({ mid: "m1", attachments: [{ type: "image", payload: {} }] }));
    expect(m.media).toEqual([]);
    expect(m.attachmentKinds).toEqual(["image"]);
  });

  it("records types with URL, skips templates, flags unsupported", () => {
    const [a] = parseDirectMessages(wrap({ mid: "m2", attachments: [{ type: "ig_reel", payload: { url: "https://x" } }, { type: "template", payload: {} }] }));
    expect(a.attachmentKinds).toEqual(["ig_reel"]);
    const [b] = parseDirectMessages(wrap({ mid: "m3", is_unsupported: true }));
    expect(b.attachmentKinds).toEqual(["unsupported"]);
    const [c] = parseDirectMessages(wrap({ mid: "m4", text: "oi" }));
    expect(c.attachmentKinds).toEqual([]);
  });
});

describe("usage points", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lastMessages: a card has text = title and a preview with buttons; a photo has a label", async () => {
    h.prisma.directMessage.findMany.mockResolvedValueOnce([
      { mid: "b", fromMe: false, text: null, template: null, sentAt: new Date(2), storyReply: false, storyKind: null, attachmentKinds: [], media: [{ type: "image" }] },
      { mid: "a", fromMe: true, text: null, template: { title: "Oi", buttons: [{ title: "Sim" }] }, sentAt: new Date(1), storyReply: false, storyKind: null, attachmentKinds: [], media: [] },
    ]);
    const out = await lastMessages("ig", "c", 3);
    expect(out.map((m) => m.mid)).toEqual(["a", "b"]);
    expect(out[0]).toMatchObject({ text: "Oi", preview: "Oi [botões: Sim]" });
    expect(out[1]).toMatchObject({ text: null, preview: "📷 Foto" });
  });

  it("previewTextsByMid labels a stored incoming photo and tolerates rows without media", async () => {
    h.prisma.directMessage.findMany.mockResolvedValueOnce([
      { mid: "p", text: null, template: null, fromMe: false, deleted: false, storyReply: false, storyKind: null, attachmentKinds: ["audio"], media: [] },
      { mid: "t", text: null, template: { title: "Cartão", buttons: [{ title: "Ir" }] }, fromMe: true },
    ]);
    const map = await previewTextsByMid({ id: "acc", instagramId: "ig" }, ["p", "t"]);
    expect(map.get("p")).toBe("🎤 Áudio");
    expect(map.get("t")).toBe("Cartão [botões: Ir]");
  });
});
