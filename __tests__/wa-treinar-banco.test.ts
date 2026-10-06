/**
 * "Treinar com um documento" num Postgres de verdade (PGlite, todas as
 * migrações): treinar não grava nada; só o Salvar grava, com a RLS do
 * workspace; os agentes e o modo do número continuam desligados; o
 * documento vai pro cérebro da qualificação guardando só o texto, e outro
 * workspace não enxerga.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { PrismaClient } from "../app/generated/prisma/client";
import { migratedDb, startPrisma } from "./helpers/pglite-db";

process.env.ENCRYPTION_KEY = "c".repeat(64);

import { encryptToken } from "../lib/meta/oauth";
import { getAgents, saveAgents, type PainelDeps } from "../lib/whatsapp/painel";
import { PrismaWaRepository } from "../lib/whatsapp/prisma-repository";
import { CerebroStore, detectVectorMode } from "../lib/whatsapp/cerebro/store";
import { createPrismaSqlExecutor, type PrismaRawLike } from "../lib/whatsapp/cerebro/sql";
import { handleKnowledgeUpload } from "../lib/whatsapp/cerebro/upload";
import { isStoredText } from "../lib/whatsapp/cerebro/texto";
import { aplicarRascunho } from "../lib/whatsapp/treinar/aplicar";
import { treinarComDocumento } from "../lib/whatsapp/treinar/treinar";
import { lerDocumento } from "../lib/whatsapp/treinar/ler";
import { briefingDocx, respostaBoaDoBriefing } from "./helpers/treinar-fixtures";

let db: PGlite;
let prisma: PrismaClient;
let stop: () => Promise<void>;
let deps: PainelDeps;

const dono = { userId: "u_d", workspaceId: "ws_d" };
const outro = { userId: "u_o", workspaceId: "ws_o" };

beforeAll(async () => {
  db = await migratedDb();
  await db.exec(`
    INSERT INTO "User"(id, email, "updatedAt", role) VALUES ('u_d', 'dono@ex.com', now(), 'USER'), ('u_o', 'outro@ex.com', now(), 'USER');
    INSERT INTO "Workspace"(id, name, "ownerId", "updatedAt") VALUES ('ws_d', 'Dono', 'u_d', now()), ('ws_o', 'Outro', 'u_o', now());
    INSERT INTO "WorkspaceMember"(id, "workspaceId", "userId", role) VALUES ('m1', 'ws_d', 'u_d', 'OWNER'), ('m2', 'ws_o', 'u_o', 'OWNER');
  `);
  await db.query(
    `INSERT INTO whatsapp."WaSession"(id, "workspaceId", "ownerUserId", provider, "providerSessionId", status, "webhookSecretEnc", "riskAcceptedAt", "updatedAt")
     VALUES ('s_d', 'ws_d', 'u_d', 'OPENWA', 'owa-d', 'CONNECTED', $1, now(), now())`,
    [encryptToken("s".repeat(43))]
  );
  ({ prisma, stop } = await startPrisma(db));
  deps = {
    repo: new PrismaWaRepository(prisma),
    queue: { addIngest: async () => undefined, addSend: async () => undefined },
    app: prisma,
    system: prisma,
  } as unknown as PainelDeps;
}, 60_000);

afterAll(async () => {
  await stop?.();
  await db?.close();
});

async function contar() {
  const r = await db.query<{ p: number; c: number; d: number; u: number }>(`SELECT
    (SELECT count(*)::int FROM whatsapp."WaAgentProfile") AS p,
    (SELECT count(*)::int FROM whatsapp."WaAgentConfig") AS c,
    (SELECT count(*)::int FROM whatsapp."WaKnowledgeDocument") AS d,
    (SELECT count(*)::int FROM whatsapp."WaAiUsage") AS u`);
  return r.rows[0];
}

describe("treinar com um documento no banco", () => {
  it("treinar não grava nada; Salvar grava e os agentes seguem desligados", async () => {
    const antes = await getAgents(dono, "s_d", deps);
    expect(antes.numberMode).toBe("OFF");
    expect(antes.agents.every((a) => !a.ativo)).toBe(true);
    const vazio = await contar();

    const leitura = await lerDocumento(briefingDocx());
    if (!leitura.ok) throw new Error(leitura.erro);
    const r = await treinarComDocumento(
      { nome: "briefing-exemplo.docx", tipo: leitura.tipo, texto: leitura.texto, cortado: leitura.cortado },
      {
        chamar: async () => ({ texto: JSON.stringify(respostaBoaDoBriefing()), uso: { tokensIn: 1, tokensOut: 1, cacheRead: 0, cacheWrite: 0 } }),
        modelo: async () => ({ provider: "anthropic", model: "claude-sonnet-5" }),
        chave: async () => "sk-ant-falsa-so-pra-teste-0000",
        precos: {},
        conferirTeto: async () => ({ ok: true }),
        registrarUso: async () => undefined,
      }
    );
    if (!r.ok) throw new Error(r.codigo);

    // Nada mudou no banco só por treinar.
    expect(await contar()).toEqual(vazio);
    expect((await getAgents(dono, "s_d", deps)).profile.baseCommand).toBe("");

    // A tela aplica o rascunho e o dono clica em Salvar (o corpo é o mesmo que a tela manda).
    const tela = aplicarRascunho(antes, r.rascunho);
    const salvo = await saveAgents(dono, { sessionId: "s_d", numberMode: tela.numberMode, profile: tela.profile, agents: tela.agents }, deps);
    expect(salvo.numberMode).toBe("OFF");
    expect(salvo.agents.every((a) => !a.ativo)).toBe(true);
    expect(salvo.profile.baseCommand).toContain("Casa Firme Reformas");
    expect(salvo.profile.baseCommand).toContain("MENSAGENS APROVADAS PELA EMPRESA");
    expect(salvo.profile.facts).toContain("Não há taxa de deslocamento");
    expect(salvo.agents.find((a) => a.agente === "qualificacao")?.instrucoes).toContain("MENSAGEM DE BOAS-VINDAS");
    const sessao = await db.query<{ agentMode: string }>(`SELECT "agentMode" FROM whatsapp."WaSession" WHERE id = 's_d'`);
    expect(sessao.rows[0].agentMode).toBe("OFF");
  });

  it("depois de salvar, o .docx vai pro cérebro da qualificação só como texto, e outro workspace não vê", async () => {
    const sqlDe = (ctx: { userId: string; workspaceId: string }) => createPrismaSqlExecutor(prisma as unknown as PrismaRawLike, ctx);
    const mode = await detectVectorMode(sqlDe(dono));
    const store = new CerebroStore(sqlDe(dono), mode);
    const form = new FormData();
    form.set("file", new Blob([Buffer.from(briefingDocx())]), "briefing-exemplo.docx");
    const out = await handleKnowledgeUpload(new Request("http://localhost/x", { method: "POST", body: form }), { ownerUserId: "u_d", workspaceId: "ws_d" }, "qualificacao", {
      store,
      enqueue: async () => undefined,
    });
    expect(out).toMatchObject({ ok: true, status: 202 });
    const docs = await store.listDocuments("ws_d", "qualificacao");
    expect(docs.map((d) => d.fileName)).toEqual(["briefing-exemplo.docx"]);
    const raw = await db.query<{ data: Uint8Array }>(`SELECT data FROM whatsapp."WaKnowledgeDocument"`);
    expect(isStoredText(new Uint8Array(raw.rows[0].data))).toBe(true);

    // Mandar de novo não duplica.
    const again = new FormData();
    again.set("file", new Blob([Buffer.from(briefingDocx())]), "briefing-exemplo.docx");
    const dup = await handleKnowledgeUpload(new Request("http://localhost/x", { method: "POST", body: again }), { ownerUserId: "u_d", workspaceId: "ws_d" }, "qualificacao", {
      store,
      enqueue: async () => undefined,
    });
    expect(dup).toMatchObject({ ok: true, duplicate: true });

    // RLS: o outro workspace não enxerga o documento do cliente.
    const deOutro = new CerebroStore(sqlDe(outro), mode);
    expect(await deOutro.listDocuments("ws_d", "qualificacao")).toEqual([]);
    expect(await deOutro.getDocument(docs[0].id, "ws_d")).toBeNull();
  });
});
