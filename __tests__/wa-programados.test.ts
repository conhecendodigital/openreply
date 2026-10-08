/**
 * Textos programados do WhatsApp (08/10/2026), num Postgres de verdade
 * (PGlite) com todas as migrações: fila por conversa, RLS, lote das 6h de
 * Brasília (10 por dia, um por conversa por dia), janela fechada não força.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { PrismaClient } from "../app/generated/prisma/client";
import { migratedDb, startPrisma } from "./helpers/pglite-db";
import {
  adicionarProgramados,
  diaBrasilia,
  enviarProgramadosDoDia,
  inicioDoDiaBrasilia,
  listarEnviados,
  listarProgramados,
  pausaEntreMensagens,
  removerProgramado,
  validarItens,
} from "../lib/whatsapp/programados";
import { PainelError, type PainelDeps } from "../lib/whatsapp/painel";
import { PrismaWaRepository } from "../lib/whatsapp/prisma-repository";
import { isApiKeyRouteAllowed } from "../lib/api-key-routes";

let db: PGlite;
let prisma: PrismaClient;
let stop: () => Promise<void>;

const dono = { userId: "u_m", workspaceId: "ws_m" };
const bia = { userId: "u_b", workspaceId: "ws_b" };

function fila() {
  const jobs: { text: string; delayMs: number | undefined }[] = [];
  const queue = {
    addSend: vi.fn(async (job: { request: { content: { text?: string } } }, opts?: { delayMs?: number }) => {
      jobs.push({ text: job.request.content.text ?? "", delayMs: opts?.delayMs });
    }),
  };
  return { jobs, queue };
}

function deps(queue: unknown): PainelDeps {
  return { repo: new PrismaWaRepository(prisma), queue: queue as PainelDeps["queue"], app: prisma, system: prisma };
}

beforeAll(async () => {
  db = await migratedDb();
  await db.exec(`
    INSERT INTO "User"(id, email, "updatedAt") VALUES ('u_m', 'm@ex.com', now()), ('u_b', 'b@ex.com', now());
    INSERT INTO "Workspace"(id, name, "ownerId", "updatedAt") VALUES ('ws_m', 'Matheus', 'u_m', now()), ('ws_b', 'Bia', 'u_b', now());
    INSERT INTO "WorkspaceMember"(id, "workspaceId", "userId", role) VALUES ('wm1', 'ws_m', 'u_m', 'OWNER'), ('wm2', 'ws_b', 'u_b', 'OWNER');
    INSERT INTO whatsapp."WaSession"(id, "workspaceId", "ownerUserId", provider, "providerSessionId", status, "conversationCount", "messageCount", "updatedAt") VALUES
      ('s_auto', 'ws_m', 'u_m', 'UAZAPI', 'inst_auto', 'CONNECTED', 2, 1, now());
    INSERT INTO whatsapp."WaContact"(id, "workspaceId", "sessionId", jid, name, "phoneE164", "updatedAt") VALUES
      ('c_eu', 'ws_m', 's_auto', '5511940667094@s.whatsapp.net', 'Matheus', '+5511940667094', now()),
      ('c_velho', 'ws_m', 's_auto', '5511900000000@s.whatsapp.net', 'Sem janela', '+5511900000000', now());
    INSERT INTO whatsapp."WaConversation"(id, "workspaceId", "sessionId", "contactId", "updatedAt") VALUES
      ('cv_eu', 'ws_m', 's_auto', 'c_eu', now()),
      ('cv_velho', 'ws_m', 's_auto', 'c_velho', now());
    INSERT INTO whatsapp."WaMessage"(id, "workspaceId", "sessionId", "conversationId", "providerMessageId", "fromMe", "sentBy", type, body, "sentAt") VALUES
      ('m1', 'ws_m', 's_auto', 'cv_eu', 'p1', false, 'CONTACT', 'text', 'boa noite', now() - interval '1 hour'),
      ('m2', 'ws_m', 's_auto', 'cv_velho', 'p2', false, 'CONTACT', 'text', 'oi', now() - interval '3 days');
  `);
  ({ prisma, stop } = await startPrisma(db));
  (globalThis as unknown as { prisma?: PrismaClient }).prisma = prisma;
}, 60_000);

afterAll(async () => {
  await stop?.();
  await db?.close();
});

describe("horário de Brasília", () => {
  it("6h de Brasília é 09:00 UTC e o dia vira à meia-noite de Brasília", () => {
    expect(diaBrasilia(new Date("2026-10-09T02:59:00Z"))).toBe("2026-10-08");
    expect(diaBrasilia(new Date("2026-10-09T03:00:00Z"))).toBe("2026-10-09");
    expect(inicioDoDiaBrasilia(new Date("2026-10-09T09:00:00Z")).toISOString()).toBe("2026-10-09T03:00:00.000Z");
  });
  it("pausa entre mensagens fica entre 35 e 45 s", () => {
    expect(pausaEntreMensagens(() => 0)).toBe(35_000);
    expect(pausaEntreMensagens(() => 0.9999)).toBeLessThan(45_000);
  });
});

describe("validação", () => {
  it("recusa lista vazia, rótulo vazio e texto grande demais", () => {
    expect(() => validarItens([])).toThrow(PainelError);
    expect(() => validarItens([{ label: "", text: "x" }])).toThrow(PainelError);
    expect(() => validarItens([{ label: "R1", text: "x".repeat(4001) }])).toThrow(PainelError);
    expect(validarItens([{ label: " R1 ", text: " oi " }])).toEqual([{ label: "R1", text: "oi" }]);
  });
});

describe("fila", () => {
  it("adiciona na ordem e ignora rótulo repetido", async () => {
    const d = deps(fila().queue);
    const r1 = await adicionarProgramados(dono, d, {
      conversationId: "cv_eu",
      itens: [
        { label: "R501", text: "Roteiro 501" },
        { label: "R502", text: "Roteiro 502" },
        { label: "R503", text: "Roteiro 503" },
      ],
    });
    expect(r1).toEqual({ criados: 3, repetidos: 0 });
    const r2 = await adicionarProgramados(dono, d, { conversationId: "cv_eu", itens: [{ label: "R502", text: "de novo" }, { label: "R504", text: "Roteiro 504" }] });
    expect(r2).toEqual({ criados: 1, repetidos: 1 });
    const lista = await listarProgramados(dono, d, "cv_eu");
    expect(lista.itens.map((i) => i.label)).toEqual(["R501", "R502", "R503", "R504"]);
    expect(lista.pendentes).toBe(4);
  });

  it("outro workspace não vê nem mexe na fila", async () => {
    const d = deps(fila().queue);
    expect((await listarProgramados(bia, d)).itens).toHaveLength(0);
    await expect(adicionarProgramados(bia, d, { conversationId: "cv_eu", itens: [{ label: "X", text: "x" }] })).rejects.toMatchObject({ status: 404 });
  });
});

describe("lote das 6h", () => {
  it("enfileira até o limite do dia, com pausa crescente, e marca QUEUED", async () => {
    const { jobs, queue } = fila();
    const r = await enviarProgramadosDoDia(deps(queue), { now: new Date(), porDia: 2, pausa: () => 40_000 });
    expect(r.conversas.find((c) => c.conversationId === "cv_eu")).toMatchObject({ enviados: 2, motivo: null });
    expect(jobs.map((j) => j.text)).toEqual(["Roteiro 501", "Roteiro 502"]);
    expect(jobs.map((j) => j.delayMs)).toEqual([0, 40_000]);
    const rows = await prisma.waScheduledText.findMany({ where: { conversationId: "cv_eu" }, orderBy: { position: "asc" } });
    expect(rows.map((x) => x.status)).toEqual(["QUEUED", "QUEUED", "PENDING", "PENDING"]);
  });

  it("não manda de novo no mesmo dia; no dia seguinte manda os próximos", async () => {
    const a = fila();
    const mesmoDia = await enviarProgramadosDoDia(deps(a.queue), { now: new Date(), porDia: 2 });
    expect(mesmoDia.conversas.find((c) => c.conversationId === "cv_eu")?.motivo).toBe("ja_enviou_hoje");
    expect(a.jobs).toHaveLength(0);

    const b = fila();
    const amanha = new Date(Date.now() + 24 * 3_600_000);
    // a janela de 24 h conta a partir do "boa noite": simula um novo à noite.
    await prisma.waMessage.create({
      data: { id: "m3", workspaceId: "ws_m", sessionId: "s_auto", conversationId: "cv_eu", providerMessageId: "p3", fromMe: false, sentBy: "CONTACT", type: "text", body: "boa noite", sentAt: new Date(amanha.getTime() - 3_600_000) },
    });
    const r = await enviarProgramadosDoDia(deps(b.queue), { now: amanha, porDia: 2, pausa: () => 1 });
    expect(r.conversas.find((c) => c.conversationId === "cv_eu")?.enviados).toBe(2);
    expect(b.jobs.map((j) => j.text)).toEqual(["Roteiro 503", "Roteiro 504"]);
  });

  it("janela fechada: não força, deixa pro próximo dia e avisa", async () => {
    const d = deps(fila().queue);
    await adicionarProgramados(dono, d, { conversationId: "cv_velho", itens: [{ label: "R600", text: "Sem janela" }] });
    const { jobs, queue } = fila();
    const r = await enviarProgramadosDoDia(deps(queue), { now: new Date() });
    const c = r.conversas.find((x) => x.conversationId === "cv_velho");
    expect(c?.enviados).toBe(0);
    expect(c?.motivo).toBeTruthy();
    expect(jobs).toHaveLength(0);
    const row = await prisma.waScheduledText.findFirst({ where: { conversationId: "cv_velho" } });
    expect(row?.status).toBe("PENDING");
    const ev = await prisma.operationalEvent.findFirst({ where: { workspaceId: "ws_m", level: "WARNING" }, orderBy: { createdAt: "desc" } });
    expect(ev?.message).toContain("Envio programado das 6h");
  });
});

describe("tirar da fila", () => {
  it("só tira o que ainda não saiu", async () => {
    const d = deps(fila().queue);
    const pend = await prisma.waScheduledText.findFirst({ where: { conversationId: "cv_velho", status: "PENDING" } });
    await expect(removerProgramado(dono, d, pend!.id)).resolves.toEqual({ removido: true });
    const saiu = await prisma.waScheduledText.findFirst({ where: { conversationId: "cv_eu", status: "QUEUED" } });
    await expect(removerProgramado(dono, d, saiu!.id)).rejects.toMatchObject({ status: 404 });
    await expect(removerProgramado(bia, d, pend!.id)).rejects.toMatchObject({ status: 404 });
  });
});

describe("o que já saiu (lido pelo Mac com chave de API)", () => {
  it("devolve rótulo e horário, nunca o texto, e só do próprio workspace", async () => {
    const r = await listarEnviados(dono, new Date(Date.now() - 7 * 86_400_000), prisma);
    expect(r.enviados.map((e) => e.label)).toEqual(["R501", "R502", "R503", "R504"]);
    expect(Object.keys(r.enviados[0]).sort()).toEqual(["conversationId", "label", "queuedAt"]);
    const outro = await listarEnviados(bia, new Date(0), prisma);
    expect(outro.enviados).toHaveLength(0);
  });

  it("a chave de API só lê os enviados; enfileirar e tirar da fila continuam só pra pessoa", () => {
    expect(isApiKeyRouteAllowed("GET", "/api/whatsapp/programados/enviados")).toBe(true);
    expect(isApiKeyRouteAllowed("POST", "/api/whatsapp/programados")).toBe(false);
    expect(isApiKeyRouteAllowed("GET", "/api/whatsapp/programados")).toBe(false);
    expect(isApiKeyRouteAllowed("DELETE", "/api/whatsapp/programados/x")).toBe(false);
  });
});
