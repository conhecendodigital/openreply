/**
 * 28/10/2026: o vendedor do Instagram manda em partes curtas (estilo zap) e o
 * contexto que ele lê diz quem escreveu cada mensagem.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockSend, mockTyping, mockRecordEvent } = vi.hoisted(() => ({
  mockPrisma: {
    contact: { findFirst: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
    draftReply: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    directMessage: { findMany: vi.fn() },
    outboundMessage: { findMany: vi.fn() },
  },
  mockSend: vi.fn(),
  mockTyping: vi.fn(async (...a: unknown[]) => (a.length >= 0 ? true : true)),
  mockRecordEvent: vi.fn(async (...a: unknown[]) => (a.length >= 0 ? true : true)),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/meta/client", () => ({
  sendDirectMessage: mockSend,
  sendTypingIndicator: mockTyping,
  MetaApiError: class MetaApiError extends Error {
    constructor(public code: number, public subcode: number | undefined, _t: string | undefined, message: string) {
      super(message);
    }
  },
}));
vi.mock("@/lib/meta/send", () => ({
  sendTracked: vi.fn(async (_ctx: unknown, send: (o: unknown) => Promise<unknown>) => send({ metadata: "le:draft:r" })),
}));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => `plain:${t}` }));
vi.mock("@/lib/contacts/record", () => ({ recordEvent: mockRecordEvent, upsertContact: vi.fn() }));

import { approveAndSend, createDraft } from "../lib/drafts/drafts";
import { shapeVendedorText, splitDraftParts } from "../lib/drafts/parts";
import { planejarRitmoInstagram, quebrarEmBolhas } from "../lib/messaging/bolhas";
import { classifySpeaker, collapseRepeatedCards, lastMessages, DEFAULT_LAST_MESSAGES } from "../lib/inbox/context";

const now = new Date("2026-10-28T12:00:00Z");

describe("divisão em partes", () => {
  it("texto curto fica numa parte só", () => {
    expect(quebrarEmBolhas("Opa, tudo bem? Me conta o que você quer resolver?")).toHaveLength(1);
  });

  it("duas frases longas viram 2 partes, a pergunta na última", () => {
    const t = "Entendi o seu caso, esse erro é bem comum quando a conta é nova e ainda não tem histórico. Você já tentou trocar o Comando por um mais específico?";
    const p = quebrarEmBolhas(t);
    expect(p).toHaveLength(2);
    expect(p[1]).toContain("?");
    expect(p[0]).not.toContain("?");
  });

  it("texto longo vira no máximo 3 partes de até ~220 caracteres (a última junta o resto)", () => {
    const t = Array.from({ length: 9 }, (_, i) => `Essa é a frase número ${i + 1} do texto bem comprido que o vendedor escreveu.`).join(" ") + " E você, o que acha?";
    const p = quebrarEmBolhas(t);
    expect(p.length).toBeLessThanOrEqual(3);
    expect(p.length).toBeGreaterThanOrEqual(2);
    expect(p[p.length - 1]).toContain("?");
    expect(p.slice(0, -1).every((x) => x.length <= 230)).toBe(true);
  });

  it("três frases viram 3 partes", () => {
    const t = "Fechou, então vou te explicar rápido como funciona por dentro. Você recebe o acesso no mesmo dia, direto no e-mail da compra. Quer que eu mande o link?";
    expect(quebrarEmBolhas(t)).toHaveLength(3);
  });

  it("linhas em branco do vendedor são respeitadas como partes (propor_resposta)", () => {
    expect(splitDraftParts("Oi!\n\nTudo bem?\n\nMe conta.\n\nE aí?")).toEqual(["Oi!", "Tudo bem?", "Me conta.\nE aí?"]);
    expect(shapeVendedorText("Oi, tudo bem?\n\nMe conta o que você precisa?").split("\n\n")).toHaveLength(2);
  });

  it("ritmo do Instagram: 1ª parte sem espera, pausa de 1 a 4 s entre as outras", () => {
    for (let i = 0; i < 20; i++) {
      const plano = planejarRitmoInstagram(["a", "b", "c"]);
      expect(plano[0].esperaMs).toBe(0);
      for (const e of plano.slice(1)) {
        expect(e.esperaMs).toBeGreaterThanOrEqual(1000);
        expect(e.esperaMs).toBeLessThanOrEqual(4000);
      }
    }
  });

  it("createDraft do vendedor guarda o texto já em partes", async () => {
    mockPrisma.contact.findFirst.mockResolvedValue({ id: "ct", instagramAccountId: "a", lastInboundAt: new Date(now.getTime() - 3_600_000), humanTakeover: false, humanTakeoverUntil: null });
    mockPrisma.draftReply.create.mockResolvedValue({ id: "d", status: "PENDING", expiresAt: null });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const text = "Entendi o seu caso, esse erro é bem comum quando a conta é nova e ainda não tem histórico. Você já tentou trocar o Comando por um mais específico?";
    await createDraft({ workspaceId: "ws", contactId: "ct", text, origin: "vendedor", now });
    vi.useRealTimers();
    const saved = mockPrisma.draftReply.create.mock.calls.at(-1)![0].data.text as string;
    expect(saved.split("\n\n")).toHaveLength(2);
  });
});

describe("envio do rascunho em partes", () => {
  const sleep = vi.fn(async () => undefined);
  function draft(text: string) {
    return {
      id: "d_1",
      workspaceId: "ws",
      instagramAccountId: "acc",
      text,
      origin: "vendedor",
      status: "PENDING",
      contact: { id: "ct", workspaceId: "ws", igUserId: "ig_p", lastInboundAt: new Date(now.getTime() - 3_600_000) },
      instagramAccount: { id: "acc", instagramId: "ig_o", accessToken: "enc", status: "ACTIVE" },
    };
  }
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    mockPrisma.draftReply.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.draftReply.update.mockResolvedValue({});
    let n = 0;
    mockSend.mockImplementation(async () => ({ recipient_id: "ig_p", message_id: `mid_${++n}` }));
  });

  it("manda 1 DM por parte, na ordem, com 'digitando' e pausa entre elas", async () => {
    mockPrisma.draftReply.findFirst.mockResolvedValue(draft("Primeira parte.\n\nSegunda parte.\n\nTerceira, certo?"));
    const r = await approveAndSend({ workspaceId: "ws", id: "d_1", approvedBy: "u", approvedVia: "session", now, sleep });
    vi.useRealTimers();
    expect(r.ok).toBe(true);
    expect(mockSend.mock.calls.map((c) => c[3])).toEqual(["Primeira parte.", "Segunda parte.", "Terceira, certo?"]);
    expect(mockTyping).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(2);
    const waits = sleep.mock.calls.map((c) => (c as unknown as number[])[0]);
    expect(waits.every((w) => w >= 1000 && w <= 4000)).toBe(true);
    const sent = mockPrisma.draftReply.update.mock.calls.at(-1)![0].data;
    expect(sent).toMatchObject({ status: "SENT", sentMid: "mid_3" });
    expect((mockRecordEvent.mock.calls.at(-1)![1] as { meta: unknown }).meta).toMatchObject({ parts: 3, mids: ["mid_1", "mid_2", "mid_3"] });
  });

  it("texto de uma parte só não usa 'digitando' nem pausa", async () => {
    mockPrisma.draftReply.findFirst.mockResolvedValue(draft("Oi, tudo bem?"));
    await approveAndSend({ workspaceId: "ws", id: "d_1", approvedBy: "u", approvedVia: "session", now, sleep });
    vi.useRealTimers();
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockTyping).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });

  it("falha na 2ª parte: rascunho FAILED dizendo que 1 de 3 já saiu, e não manda a 3ª", async () => {
    mockPrisma.draftReply.findFirst.mockResolvedValue(draft("A.\n\nB.\n\nC?"));
    mockSend.mockReset();
    mockSend.mockResolvedValueOnce({ recipient_id: "ig_p", message_id: "mid_1" }).mockRejectedValueOnce(new Error("boom"));
    const r = await approveAndSend({ workspaceId: "ws", id: "d_1", approvedBy: "u", approvedVia: "session", now, sleep });
    vi.useRealTimers();
    expect(r.ok).toBe(false);
    expect(mockSend).toHaveBeenCalledTimes(2);
    const upd = mockPrisma.draftReply.update.mock.calls.at(-1)![0].data;
    expect(upd.status).toBe("FAILED");
    expect(upd.error).toContain("Enviou 1 de 3");
  });

  it("janela fechada no meio vira EXPIRED com erro claro", async () => {
    mockPrisma.draftReply.findFirst.mockResolvedValue(draft("A.\n\nB?"));
    mockSend.mockReset();
    mockSend.mockResolvedValueOnce({ recipient_id: "ig_p", message_id: "mid_1" }).mockRejectedValueOnce(Object.assign(new Error("(#10) Outside of allowed window"), { code: 10 }));
    const r = await approveAndSend({ workspaceId: "ws", id: "d_1", approvedBy: "u", approvedVia: "session", now, sleep });
    vi.useRealTimers();
    expect(r).toMatchObject({ ok: false, code: "window_closed" });
    expect(mockPrisma.draftReply.update.mock.calls.at(-1)![0].data.status).toBe("EXPIRED");
  });
});

describe("contexto honesto", () => {
  it("classifica quem escreveu", () => {
    expect(classifySpeaker(false, null)).toBe("person");
    expect(classifySpeaker(true, null)).toBe("owner_phone");
    expect(classifySpeaker(true, { origin: "flow" })).toBe("flow");
    expect(classifySpeaker(true, { origin: "automation" })).toBe("flow");
    expect(classifySpeaker(true, { origin: "draft", refId: "d" }, "vendedor")).toBe("vendedor");
    expect(classifySpeaker(true, { origin: "draft", refId: "d" }, "manual")).toBe("owner_app");
    expect(classifySpeaker(true, { origin: "inbox" })).toBe("owner_app");
  });

  it("o padrão agora é 12 mensagens", () => {
    expect(DEFAULT_LAST_MESSAGES).toBe(12);
  });

  const row = (over: Record<string, unknown>) => ({
    mid: "m", fromMe: false, text: null, template: null, sentAt: now, storyReply: false, storyKind: null, attachmentKinds: [], media: [], ...over,
  });

  it("cartão do fluxo e rótulo de anexo não parecem fala da pessoa", async () => {
    mockPrisma.directMessage.findMany.mockResolvedValue([
      row({ mid: "m3", fromMe: false, attachmentKinds: ["image"], sentAt: new Date(now.getTime() + 3) }),
      row({ mid: "m2", fromMe: true, template: { title: "Quer o Comando?", buttons: [{ title: "Quero" }] }, sentAt: new Date(now.getTime() + 2) }),
      row({ mid: "m1", fromMe: false, text: "oi", sentAt: new Date(now.getTime() + 1) }),
    ]);
    mockPrisma.outboundMessage.findMany.mockResolvedValue([{ mid: "m2", origin: "flow", refId: "r" }]);
    const list = await lastMessages("ig_o", "ig_p");
    expect(mockPrisma.directMessage.findMany.mock.calls.at(-1)![0].take).toBe(12);
    expect(list.map((m) => [m.mid, m.speaker, m.kind])).toEqual([
      ["m1", "person", "text"],
      ["m2", "flow", "card"],
      ["m3", "person", "attachment"],
    ]);
    expect(list[1].speakerLabel).toContain("não é a pessoa");
  });

  it("mensagem nossa sem linha no ledger é 'você pelo celular'; vendedor vem do rascunho", async () => {
    mockPrisma.directMessage.findMany.mockResolvedValue([
      row({ mid: "b", fromMe: true, text: "do vendedor", sentAt: new Date(now.getTime() + 2) }),
      row({ mid: "a", fromMe: true, text: "digitei no celular", sentAt: new Date(now.getTime() + 1) }),
    ]);
    mockPrisma.outboundMessage.findMany.mockResolvedValue([{ mid: "b", origin: "draft", refId: "d9" }]);
    mockPrisma.draftReply.findMany.mockResolvedValue([{ id: "d9", origin: "vendedor" }]);
    const list = await lastMessages("ig_o", "ig_p");
    expect(list.map((m) => m.speaker)).toEqual(["owner_phone", "vendedor"]);
  });

  it("sem ledger (erro) não chuta 'celular': marca origem não conferida", async () => {
    mockPrisma.directMessage.findMany.mockResolvedValue([row({ mid: "a", fromMe: true, text: "x" })]);
    mockPrisma.outboundMessage.findMany.mockRejectedValue(new Error("db"));
    const list = await lastMessages("ig_o", "ig_p");
    expect(list[0].speaker).toBe("us");
  });

  it("cartões iguais em sequência colapsam", () => {
    const card = (mid: string) => ({
      mid, fromMe: true, speaker: "flow" as const, speakerLabel: "x", kind: "card" as const, repeated: 1,
      text: "Quer?", preview: "Quer? [botões: Quero]", sentAt: now, storyReply: false, storyKind: null,
    });
    const out = collapseRepeatedCards([card("1"), card("2"), card("3")]);
    expect(out).toHaveLength(1);
    expect(out[0].repeated).toBe(3);
  });
});
