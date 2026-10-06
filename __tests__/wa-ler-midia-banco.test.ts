/**
 * Leitura de mídia no Postgres (PGlite com todas as migrações): a coluna
 * nova, o worker lendo o áudio pelo gateway com a RLS do dono, o gasto em
 * WaAiUsage (kind "midia"), o agente recebendo a transcrição e a tela de
 * Conversas mostrando o que o agente entendeu. Transcritor e visão falsos.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { PrismaClient } from "../app/generated/prisma/client";
import { migratedDb, migrationNames, startPrisma } from "./helpers/pglite-db";
import { pdfSimples } from "./helpers/pdf-simples";

process.env.ENCRYPTION_KEY = "c".repeat(64);

import { encryptToken } from "../lib/meta/oauth";
import { withSystemRole } from "../lib/db/rls";
import { PrismaWaRepository } from "../lib/whatsapp/prisma-repository";
import { getThread, type GatewayClient } from "../lib/whatsapp/painel";
import { lerMidiasDoJob } from "../lib/whatsapp/midia/worker";
import { storeFor } from "../lib/whatsapp/agentes/worker";
import { historicoParaChat } from "../lib/whatsapp/agentes/comando";
import type { WaAgentJob, WaQueuePort } from "../lib/whatsapp/queue";
import type { PedidoTranscricao } from "../lib/whatsapp/midia/provedores";

let db: PGlite;
let prisma: PrismaClient;
let stop: () => Promise<void>;
let repo: PrismaWaRepository;

const NOW = new Date();
const queue: WaQueuePort = { addIngest: async () => {}, addSend: async () => {} };
const ctx = { userId: "u_m", workspaceId: "ws_m" };

function ogg(segundos: number): Uint8Array {
  const b = new Uint8Array(3000);
  b.set([0x4f, 0x67, 0x67, 0x53], 0);
  b.set([0x4f, 0x67, 0x67, 0x53], 2000);
  new DataView(b.buffer, 2006, 8).setUint32(0, segundos * 48_000, true);
  return b;
}

const midias: Record<string, Uint8Array | null> = {
  "wamid.audio": ogg(20),
  "wamid.pdf": pdfSimples(["Lista de medidas da cozinha 3 m"]),
  "wamid.foto": null, // gateway não acha: falha sem travar
};
const gateway = {
  fetchMedia: vi.fn(async (_jid: string, id: string) => {
    const b = midias[id];
    return b ? { bytes: b, contentType: id === "wamid.audio" ? "audio/ogg" : "application/pdf" } : null;
  }),
} as unknown as GatewayClient;

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- o parâmetro tipa mock.calls
const transcrever = vi.fn(async (_p: PedidoTranscricao) => ({
  texto: "Bom dia, quanto fica um armário de cozinha de três metros?",
  modelo: "gpt-4o-mini-transcribe",
  uso: { tokensIn: 800, tokensOut: 15 },
}));

const job: WaAgentJob = { kind: "inbound", ownerUserId: "u_m", workspaceId: "ws_m", sessionId: "s_m", conversationId: "cv1", messageId: "m_audio" };

beforeAll(async () => {
  db = await migratedDb();
  await db.exec(`
    INSERT INTO "User"(id, email, "updatedAt", role) VALUES ('u_m', 'matheus@ex.com', now(), 'ADMIN'), ('u_b', 'bia@ex.com', now(), 'USER');
    INSERT INTO "Workspace"(id, name, "ownerId", "updatedAt") VALUES ('ws_m', 'Matheus', 'u_m', now()), ('ws_b', 'Bia', 'u_b', now());
    INSERT INTO "WorkspaceMember"(id, "workspaceId", "userId", role) VALUES ('wm1', 'ws_m', 'u_m', 'OWNER'), ('wm2', 'ws_b', 'u_b', 'OWNER');
  `);
  await db.query(
    `INSERT INTO whatsapp."WaSession"(id, "workspaceId", "ownerUserId", provider, "providerSessionId", status, "webhookSecretEnc", "riskAcceptedAt", "agentMode", "updatedAt")
     VALUES ('s_m', 'ws_m', 'u_m', 'OPENWA', 'owa-m', 'CONNECTED', $1, now(), 'DRAFT', now())`,
    [encryptToken("s".repeat(43))]
  );
  const t = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
  await db.exec(
    `INSERT INTO whatsapp."WaContact"(id, "workspaceId", "sessionId", jid, "updatedAt") VALUES ('ct1', 'ws_m', 's_m', '5511988887777@c.us', now());
     INSERT INTO whatsapp."WaConversation"(id, "workspaceId", "sessionId", "contactId", "updatedAt") VALUES ('cv1', 'ws_m', 's_m', 'ct1', now());
     INSERT INTO whatsapp."WaAgentConfig"(id, "workspaceId", "ownerUserId", "sessionId", agente, ativo) VALUES ('ac1', 'ws_m', 'u_m', 's_m', 'atendimento', true);`
  );
  await db.query(
    `INSERT INTO whatsapp."WaMessage"(id, "workspaceId", "sessionId", "conversationId", "providerMessageId", "fromMe", "sentBy", type, body, "sentAt", "mediaMime", "mediaFilename") VALUES
      ('m_pdf', 'ws_m', 's_m', 'cv1', 'wamid.pdf', false, 'CONTACT', 'document', NULL, $1, 'application/pdf', 'medidas.pdf'),
      ('m_foto', 'ws_m', 's_m', 'cv1', 'wamid.foto', false, 'CONTACT', 'image', 'olha a parede', $2, 'image/jpeg', NULL),
      ('m_video', 'ws_m', 's_m', 'cv1', 'wamid.video', false, 'CONTACT', 'video', NULL, $3, 'video/mp4', NULL),
      ('m_audio', 'ws_m', 's_m', 'cv1', 'wamid.audio', false, 'CONTACT', 'audio', NULL, $4, 'audio/ogg; codecs=opus', NULL)`,
    [t(4), t(3), t(2), t(1)]
  );
  ({ prisma, stop } = await startPrisma(db));
  repo = new PrismaWaRepository(prisma);
}, 60_000);

afterAll(async () => {
  await stop?.();
  await db?.close();
});

describe("leitura de mídia no banco", () => {
  it("a migração vem depois da wa_excluir_numero", () => {
    const names = migrationNames();
    expect(names.indexOf("20261019120000_wa_ler_midia")).toBeGreaterThan(names.indexOf("20261018130000_wa_excluir_numero"));
  });

  it("a migração cria as três colunas opcionais em WaMessage", async () => {
    const r = await db.query<{ column_name: string; is_nullable: string }>(
      `SELECT column_name, is_nullable FROM information_schema.columns
       WHERE table_schema = 'whatsapp' AND table_name = 'WaMessage' AND column_name LIKE 'mediaText%' ORDER BY 1`
    );
    expect(r.rows).toEqual([
      { column_name: "mediaText", is_nullable: "YES" },
      { column_name: "mediaTextKind", is_nullable: "YES" },
      { column_name: "mediaTextStatus", is_nullable: "YES" },
    ]);
  });

  it("agente desligado no número: não lê nada (ninguém paga)", async () => {
    await db.query(`UPDATE whatsapp."WaSession" SET "agentMode" = 'OFF' WHERE id = 's_m'`);
    const r = await lerMidiasDoJob(job, { repo, queue, app: prisma, system: prisma, connectorFor: () => gateway, sobrescrever: { transcrever, chave: async () => "sk-fake" }, now: NOW });
    expect(r).toEqual([]);
    await db.query(`UPDATE whatsapp."WaSession" SET "agentMode" = 'DRAFT' WHERE id = 's_m'`);
  });

  it("lê áudio, PDF e foto (falhou) pelo gateway, salva com a RLS do dono e grava o gasto", async () => {
    const r = await lerMidiasDoJob(job, {
      repo,
      queue,
      app: prisma,
      system: prisma,
      connectorFor: () => gateway,
      sobrescrever: { transcrever, chave: async (p) => (p === "openai" ? "sk-fake-openai" : "sk-ant-fake") },
      now: NOW,
    });
    expect(r).toEqual([
      { kind: "audio", status: "ok" },
      { kind: "image", status: "failed" },
      { kind: "pdf", status: "ok" },
    ]);
    const rows = await withSystemRole(
      (tx) => tx.waMessage.findMany({ where: { conversationId: "cv1" }, select: { id: true, mediaText: true, mediaTextKind: true, mediaTextStatus: true }, orderBy: { id: "asc" } }),
      prisma
    );
    const by = Object.fromEntries(rows.map((x) => [x.id, x]));
    expect(by.m_audio).toMatchObject({ mediaTextKind: "audio", mediaTextStatus: "ok", mediaText: expect.stringContaining("armário de cozinha") });
    expect(by.m_pdf).toMatchObject({ mediaTextKind: "pdf", mediaTextStatus: "ok", mediaText: expect.stringContaining("Lista de medidas") });
    expect(by.m_foto).toMatchObject({ mediaTextKind: "image", mediaTextStatus: "failed", mediaText: null });
    expect(by.m_video).toMatchObject({ mediaTextKind: null, mediaTextStatus: null });

    const usage = await withSystemRole((tx) => tx.waAiUsage.findMany({ where: { kind: "midia" } }), prisma);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ agent: "midia", provider: "openai", model: "gpt-4o-mini-transcribe", tokensIn: 800, tokensOut: 15, blocked: false, refId: "m_audio", conversationId: "cv1" });
    // 800 * 1,25 + 15 * 5 = 1075 micro dólar, com o preço que entra por baixo da tabela do /admin.
    expect(Number(usage[0].costMicroUsd)).toBe(1075);
  });

  it("não lê de novo o que já leu", async () => {
    transcrever.mockClear();
    const r = await lerMidiasDoJob(job, { repo, queue, app: prisma, system: prisma, connectorFor: () => gateway, sobrescrever: { transcrever, chave: async () => "k" }, now: NOW });
    expect(r).toEqual([]);
    expect(transcrever).not.toHaveBeenCalled();
  });

  it("Conversas mostra a transcrição e o motivo da foto que não foi lida; outro workspace não vê", async () => {
    const view = await getThread(ctx, "cv1", { repo, queue, app: prisma, system: prisma });
    const audio = view.messages.find((m) => m.id === "m_audio")!;
    expect(audio.mediaRead).toEqual({ kind: "audio", status: "ok", text: expect.stringContaining("três metros") });
    expect(view.messages.find((m) => m.id === "m_foto")!.mediaRead).toEqual({ kind: "image", status: "failed", text: null });
    expect(view.messages.find((m) => m.id === "m_video")!.mediaRead).toBeNull();
    await expect(getThread({ userId: "u_b", workspaceId: "ws_b" }, "cv1", { repo, queue, app: prisma, system: prisma })).rejects.toThrow();
  });

  it("o contexto do agente (store de produção) traz o texto lido, e o histórico pro modelo usa ele", async () => {
    const store = storeFor("u_m", "ws_m", { repo, queue, app: prisma, system: prisma });
    const contexto = await store.carregarContexto("cv1");
    const audio = contexto!.historico.find((m) => m.id === "m_audio")!;
    expect(audio).toMatchObject({ mediaTextKind: "audio", mediaText: expect.stringContaining("armário") });
    const chat = historicoParaChat(contexto!.historico);
    expect(chat).toHaveLength(1);
    expect(chat[0].content).toContain("[pdf]");
    // Foto que não foi lida: fica a legenda escrita.
    expect(chat[0].content).toContain("olha a parede");
    expect(chat[0].content).toContain("[video]");
    expect(chat[0].content).toContain('[áudio transcrito]\n<dados origem="áudio do cliente">');
  });
});
