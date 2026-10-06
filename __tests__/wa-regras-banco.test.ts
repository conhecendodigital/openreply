/**
 * Regras duras, ficha, estágio do lead e aprendizado num Postgres de verdade
 * (PGlite com TODAS as migrações): migração aditiva com RLS forçada, Salvar
 * grava as regras, store do motor (exemplos com limite, casos, ficha,
 * estágio com histórico só de inclusão), sugestão só vira regra com o clique,
 * quadro de leads com filtros, CSV, estágio manual, ficha do dono, resposta
 * pelo inbox vira exemplo, e outro workspace não enxerga nada.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { PrismaClient } from "../app/generated/prisma/client";
import { migratedDb, migrationNames, startPrisma } from "./helpers/pglite-db";

process.env.ENCRYPTION_KEY = "e".repeat(64);

import { encryptToken } from "../lib/meta/oauth";
import { withRls } from "../lib/db/rls";
import { PrismaWaRepository } from "../lib/whatsapp/prisma-repository";
import type { WaIngestJob, WaQueuePort, WaSendJob } from "../lib/whatsapp/queue";
import { getAgents, getThread, listConversations, saveAgents, sendReply, type PainelDeps } from "../lib/whatsapp/painel";
import { PrismaAgentStore, MAX_CASOS } from "../lib/whatsapp/agentes/store-prisma";
import { decideSuggestion, editLeadFicha, exportLeadsCsv, getLearning, listLeads, releaseLeadStage, removeExample, setLeadStage } from "../lib/whatsapp/regras/painel";
import { MAX_EXEMPLOS } from "../lib/whatsapp/regras/exemplos";
import { lerRegras } from "../lib/whatsapp/regras/esquema";
import { obraBoa } from "./helpers/regras-fixtures";

let db: PGlite;
let prisma: PrismaClient;
let stop: () => Promise<void>;
let deps: PainelDeps;
const envios: WaSendJob[] = [];

class FakeQueue implements WaQueuePort {
  async addIngest(job: WaIngestJob) {
    void job;
  }
  async addSend(job: WaSendJob) {
    envios.push(job);
  }
}

const dono = { userId: "u_d", workspaceId: "ws_d" };
const outro = { userId: "u_o", workspaceId: "ws_o" };

async function conversa(id: string, contato: string, nome: string, mensagens: Array<[string, boolean, string, number]>) {
  await db.query(
    `INSERT INTO whatsapp."WaContact"(id, "workspaceId", "sessionId", jid, "pushName", "phoneE164", "updatedAt") VALUES ($1, 'ws_d', 's_d', $2, $3, $4, now())`,
    [contato, `${contato}@c.us`, nome, `+55199${contato.replace(/\D/g, "").padStart(8, "0")}`]
  );
  await db.query(
    `INSERT INTO whatsapp."WaConversation"(id, "workspaceId", "sessionId", "contactId", "lastMessageAt", "updatedAt") VALUES ($1, 'ws_d', 's_d', $2, now() - interval '1 minute', now())`,
    [id, contato]
  );
  for (const [mid, fromMe, body, minutos] of mensagens) {
    await db.query(
      `INSERT INTO whatsapp."WaMessage"(id, "workspaceId", "sessionId", "conversationId", "providerMessageId", "fromMe", "sentBy", type, body, "sentAt")
       VALUES ($1, 'ws_d', 's_d', $2, $3, $4, $5, 'text', $6, now() - ($7 || ' minutes')::interval)`,
      [mid, id, `p_${mid}`, fromMe, fromMe ? "AGENT" : "CONTACT", body, String(minutos)]
    );
  }
}

function store(ctx = dono) {
  return new PrismaAgentStore(ctx.userId, ctx.workspaceId, { repo: deps.repo, queue: deps.queue, app: prisma, system: prisma });
}

beforeAll(async () => {
  db = await migratedDb();
  await db.exec(`
    INSERT INTO "User"(id, email, "updatedAt", role) VALUES ('u_d', 'dono@ex.com', now(), 'USER'), ('u_o', 'outro@ex.com', now(), 'USER');
    INSERT INTO "Workspace"(id, name, "ownerId", "updatedAt") VALUES ('ws_d', 'Dono', 'u_d', now()), ('ws_o', 'Outro', 'u_o', now());
    INSERT INTO "WorkspaceMember"(id, "workspaceId", "userId", role) VALUES ('m1', 'ws_d', 'u_d', 'OWNER'), ('m2', 'ws_o', 'u_o', 'OWNER');
  `);
  await db.query(
    `INSERT INTO whatsapp."WaSession"(id, "workspaceId", "ownerUserId", provider, "providerSessionId", status, "webhookSecretEnc", "riskAcceptedAt", "agentMode", "displayName", "updatedAt")
     VALUES ('s_d', 'ws_d', 'u_d', 'OPENWA', 'owa-d', 'CONNECTED', $1, now(), 'DRAFT', 'Obra Boa', now())`,
    [encryptToken("s".repeat(43))]
  );
  await conversa("v1", "c1", "Cliente Um", [["m1", false, "Oi, quero reformar meu apartamento em Sumaré/SP", 5]]);
  await conversa("v2", "c2", "Cliente Dois", [["m2", false, "Casa em Campinas, quero reforma completa", 4]]);
  await conversa("v3", "c3", "Cliente Tres", [["m3", false, "vocês fazem orçamento de graça?", 3]]);
  ({ prisma, stop } = await startPrisma(db));
  deps = { repo: new PrismaWaRepository(prisma), queue: new FakeQueue(), app: prisma, system: prisma } as unknown as PainelDeps;
}, 60_000);

afterAll(async () => {
  await stop?.();
  await db?.close();
});

describe("migração 20261020120000_wa_regras_aprendizado", () => {
  it("vem depois da leitura de mídia, cria as tabelas com RLS forçada e as colunas opcionais", async () => {
    const nomes = migrationNames();
    expect(nomes.indexOf("20261020120000_wa_regras_aprendizado")).toBeGreaterThan(nomes.indexOf("20261019120000_wa_ler_midia"));
    const r = await db.query<{ relname: string; relforcerowsecurity: boolean }>(
      `SELECT c.relname, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'whatsapp' AND c.relname IN ('WaAgentExample', 'WaAgentLearningCase', 'WaAgentSuggestion', 'WaLeadStageEvent')`
    );
    expect(r.rows).toHaveLength(4);
    expect(r.rows.every((x) => x.relforcerowsecurity)).toBe(true);
    const cols = await db.query<{ table_name: string; column_name: string; is_nullable: string }>(
      `SELECT table_name, column_name, is_nullable FROM information_schema.columns WHERE table_schema = 'whatsapp'
       AND column_name IN ('regrasNegocio', 'debounceSeconds', 'estagiosLead', 'avisarResponsavel', 'leadFicha', 'leadStage', 'leadStageManual')`
    );
    const mapa = Object.fromEntries(cols.rows.map((c) => [c.column_name, c.is_nullable]));
    expect(mapa).toMatchObject({ regrasNegocio: "YES", estagiosLead: "YES", avisarResponsavel: "YES", leadFicha: "YES", leadStage: "YES", debounceSeconds: "NO", leadStageManual: "NO" });
  });
});

describe("Salvar grava as regras (e só o Salvar)", () => {
  it("regras, janela, estágios e aviso do responsável (desligado) voltam no getAgents; outro workspace não lê", async () => {
    const antes = await getAgents(dono, "s_d", deps);
    expect(antes.rules.cidadesAtendidas).toEqual([]);
    expect(antes.profile.debounceSeconds).toBe(10);
    expect(antes.notifyOwner).toEqual({ ligado: false, telefone: "" });
    const salvo = await saveAgents(
      dono,
      {
        sessionId: "s_d",
        numberMode: "AUTO",
        profile: { ...antes.profile, baseCommand: "Obra Boa Teste", debounceSeconds: 99 },
        agents: [{ agente: "qualificacao", ativo: true, instrucoes: "Pergunte a cidade primeiro." }],
        rules: obraBoa(),
        stages: { qualificado: { nome: "Pronto pra reunião" }, sem_resposta: { oculto: true }, novo: { oculto: true } },
        notifyOwner: { telefone: "(19) 90000-3333" },
      },
      deps
    );
    expect(salvo.rules.cidadesAtendidas.map((c) => c.cidade)).toEqual(["Paulínia", "Campinas"]);
    expect(salvo.profile.debounceSeconds).toBe(30);
    expect(salvo.stages.qualificado.nome).toBe("Pronto pra reunião");
    expect(salvo.stages.sem_resposta.oculto).toBe(true);
    expect(salvo.stages.novo.oculto).toBe(false);
    expect(salvo.notifyOwner).toEqual({ ligado: false, telefone: "(19) 90000-3333" });
    // Salvar sem o campo rules não apaga as regras.
    const deNovo = await saveAgents(dono, { sessionId: "s_d", numberMode: "AUTO", profile: salvo.profile, agents: salvo.agents }, deps);
    expect(deNovo.rules.cidadesAtendidas).toHaveLength(2);
    // RLS: o outro workspace não enxerga o perfil.
    expect(await withRls(outro, (tx) => tx.waAgentProfile.count(), prisma)).toBe(0);
  });

  it("o motor lê as regras, a ficha e o estágio pelo store", async () => {
    const ctx = await store().carregarContexto("v1");
    expect(ctx?.profile?.regras?.cidadesAtendidas).toHaveLength(2);
    expect(ctx?.conversation.lead).toMatchObject({ estagio: null, manual: false });
  });
});

describe("store do motor (exemplos, casos, ficha, estágio)", () => {
  it(`exemplos: no máximo ${MAX_EXEMPLOS} por número, o mesmo origemId não duplica, outro workspace não vê`, async () => {
    const s = store();
    for (let i = 0; i < MAX_EXEMPLOS + 3; i++) {
      await s.registrarExemplo({ sessionId: "s_d", agente: "qualificacao", origem: "assumir", origemId: `msg:${i}`, pergunta: `pergunta ${i}`, resposta: `resposta ${i}` });
    }
    await s.registrarExemplo({ sessionId: "s_d", agente: "qualificacao", origem: "assumir", origemId: `msg:${MAX_EXEMPLOS + 2}`, pergunta: "repetida", resposta: "repetida" });
    const todos = await s.exemplosAprendidos("s_d");
    expect(todos).toHaveLength(MAX_EXEMPLOS);
    expect(todos.some((e) => e.pergunta === "repetida")).toBe(false);
    expect(todos.some((e) => e.origemId === "msg:0")).toBe(false);
    expect(await store(outro).exemplosAprendidos("s_d")).toEqual([]);
    expect(await withRls(outro, (tx) => tx.waAgentExample.count(), prisma)).toBe(0);
    // Remover pela tela.
    const um = todos[0];
    expect(await removeExample(dono, um.id!, deps)).toEqual({ ok: true });
    await expect(removeExample(outro, todos[1].id!, deps)).rejects.toMatchObject({ code: "not_found" });
    await db.exec(`DELETE FROM whatsapp."WaAgentExample"`);
  });

  it(`casos: o mesmo caso não duplica e guarda no máximo ${MAX_CASOS}`, async () => {
    const s = store();
    await s.registrarCaso({ sessionId: "s_d", tipo: "fora_da_area", assunto: "Sumaré/SP", conversaHash: "h1", origemId: "fora:h1:sumare sp" });
    await s.registrarCaso({ sessionId: "s_d", tipo: "fora_da_area", assunto: "Sumaré/SP", conversaHash: "h1", origemId: "fora:h1:sumare sp" });
    expect(await withRls(dono, (tx) => tx.waAgentLearningCase.count(), prisma)).toBe(1);
    expect(await withRls(outro, (tx) => tx.waAgentLearningCase.count(), prisma)).toBe(0);
    await db.exec(`DELETE FROM whatsapp."WaAgentLearningCase"`);
  });

  it("ficha e estágio gravam; o histórico só cresce (sem UPDATE nem DELETE)", async () => {
    const s = store();
    await s.salvarFicha("v1", { campos: { local_da_obra: { valor: "Sumaré/SP", msgId: "m1", origem: "confirmado", nota: "fora da área", em: "x" } }, atualizadoEm: "x" });
    await s.salvarEstagio({ conversationId: "v1", sessionId: "s_d", de: null, nova: { estagio: "fora_do_perfil", motivo: "obra em Sumaré/SP, fora de Paulínia/SP e Campinas/SP", tipo: "regiao" }, manual: false, porUserId: null });
    const ctx = await s.carregarContexto("v1");
    expect(ctx?.conversation.lead).toMatchObject({ estagio: "fora_do_perfil", manual: false });
    expect(ctx?.conversation.lead?.ficha.campos.local_da_obra.valor).toBe("Sumaré/SP");
    const ev = await withRls(dono, (tx) => tx.waLeadStageEvent.findMany(), prisma);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ de: null, para: "fora_do_perfil", tipo: "regiao", manual: false, porUserId: null });
    // Outro workspace não grava estágio aqui.
    await store(outro).salvarEstagio({ conversationId: "v1", sessionId: "s_d", de: null, nova: { estagio: "qualificado", motivo: "x", tipo: null }, manual: false, porUserId: null });
    expect((await s.carregarContexto("v1"))?.conversation.lead?.estagio).toBe("fora_do_perfil");

    const attempt = async (sql: string) => {
      await db.exec("BEGIN");
      try {
        await db.query(`SELECT set_config('app.user_id', 'u_d', true), set_config('app.workspace_id', 'ws_d', true)`);
        await db.exec("SET LOCAL ROLE le_app");
        const r = await db.query(sql);
        return { denied: false, affected: r.affectedRows ?? 0 };
      } catch {
        return { denied: true, affected: 0 };
      } finally {
        await db.exec("ROLLBACK");
      }
    };
    const upd = await attempt(`UPDATE whatsapp."WaLeadStageEvent" SET para = 'qualificado'`);
    expect(upd.denied || upd.affected === 0).toBe(true);
    const del = await attempt(`DELETE FROM whatsapp."WaLeadStageEvent"`);
    expect(del.denied || del.affected === 0).toBe(true);
  });
});

describe("O que o agente aprendeu: sugestão só vira regra com o clique do dono", () => {
  it("3 pessoas de Hortolândia viram uma sugestão pendente; recusar não muda nada; aceitar muda", async () => {
    const s = store();
    for (const h of ["a", "b", "c"]) {
      await s.registrarCaso({ sessionId: "s_d", tipo: "fora_da_area", assunto: "Hortolândia/SP", conversaHash: h, origemId: `fora:${h}:hortolandia sp` });
    }
    await s.registrarCaso({ sessionId: "s_d", tipo: "regra_bloqueou", regra: "qualificado_fora_da_area,confirmou_fora_da_area", assunto: "Hortolândia/SP", origemId: "bloqueou:1" });
    await s.registrarCaso({ sessionId: "s_d", tipo: "regra_corrigiu", regra: "qualificado_fora_da_area", origemId: "corrigiu:1" });
    const regrasAntes = (await getAgents(dono, "s_d", deps)).rules;

    const rel = await getLearning(dono, "s_d", deps);
    expect(rel.suggestions).toHaveLength(1);
    expect(rel.suggestions[0].text).toContain("3 pessoas de Hortolândia/SP");
    expect(rel.blocked).toMatchObject({ total: 2, corrected: 1 });
    expect(rel.blocked.byRule[0]).toEqual({ rule: "qualificado_fora_da_area", count: 2 });
    expect(rel.outside).toEqual([{ subject: "Hortolândia/SP", people: 3 }]);
    // Gerar o relatório de novo não duplica nem muda a regra.
    expect((await getLearning(dono, "s_d", deps)).suggestions).toHaveLength(1);
    expect((await getAgents(dono, "s_d", deps)).rules).toEqual(regrasAntes);

    // Outro workspace não decide.
    await expect(decideSuggestion(outro, rel.suggestions[0].id, { action: "accept" }, deps)).rejects.toMatchObject({ code: "not_found" });

    // Recusar: regra igual, e a mesma sugestão não volta.
    expect(await decideSuggestion(dono, rel.suggestions[0].id, { action: "reject" }, deps)).toEqual({ ok: true, applied: false });
    expect((await getAgents(dono, "s_d", deps)).rules).toEqual(regrasAntes);
    expect((await getLearning(dono, "s_d", deps)).suggestions).toHaveLength(0);
    await expect(decideSuggestion(dono, rel.suggestions[0].id, { action: "accept" }, deps)).rejects.toMatchObject({ code: "already_decided" });

    // Aceitar (uma sugestão nova, da IA, com mudança válida): aí sim muda.
    await withRls(
      dono,
      (tx) =>
        tx.waAgentSuggestion.create({
          data: { workspaceId: "ws_d", ownerUserId: "u_d", sessionId: "s_d", origem: "ia", chave: "ia:quartzo", texto: "Quer atender quartzo?", mudanca: { acao: "adicionar_excecao_servico", descricao: "Quartzo", palavras: ["quartzo"] } },
        }),
      prisma
    );
    const id = (await getLearning(dono, "s_d", deps)).suggestions[0].id;
    expect(await decideSuggestion(dono, id, { action: "accept" }, deps)).toEqual({ ok: true, applied: true });
    const depois = (await getAgents(dono, "s_d", deps)).rules;
    expect(depois.excecoesServico.map((e) => e.descricao)).toContain("Quartzo");
    expect(depois.cidadesAtendidas).toEqual(regrasAntes.cidadesAtendidas);

    // Sugestão de instrução vai pra instrução do agente.
    await withRls(
      dono,
      (tx) =>
        tx.waAgentSuggestion.create({
          data: { workspaceId: "ws_d", ownerUserId: "u_d", sessionId: "s_d", origem: "ia", chave: "ia:instr", texto: "Peça fotos.", mudanca: { acao: "acrescentar_instrucao", agente: "qualificacao", texto: "Peça fotos do ambiente." } },
        }),
      prisma
    );
    const id2 = (await getLearning(dono, "s_d", deps)).suggestions[0].id;
    await decideSuggestion(dono, id2, { action: "accept" }, deps);
    const ag = (await getAgents(dono, "s_d", deps)).agents.find((a) => a.agente === "qualificacao");
    expect(ag?.instrucoes).toBe("Pergunte a cidade primeiro.\nPeça fotos do ambiente.");
    expect(ag?.ativo).toBe(true);
  });
});

describe("CRM: quadro de leads, estágio manual, ficha do dono e CSV", () => {
  it("quadro por estágio com contagem, nome do número, estágio escondido e filtros", async () => {
    const b = await listLeads(dono, { sessionId: "s_d" }, deps);
    const col = (s: string) => b.columns.find((c) => c.stage === s);
    expect(col("fora_do_perfil")?.count).toBe(1);
    expect(col("fora_do_perfil")?.cards[0]).toMatchObject({ conversationId: "v1", reason: "obra em Sumaré/SP, fora de Paulínia/SP e Campinas/SP", manual: false });
    expect(col("fora_do_perfil")?.cards[0].summary).toContain("Local da obra: Sumaré/SP (fora da área)");
    expect(col("novo")?.count).toBe(2);
    expect(col("qualificado")?.name).toBe("Pronto pra reunião");
    expect(col("sem_resposta")).toBeUndefined();
    expect((await listLeads(dono, { sessionId: "s_d", stage: "fora_do_perfil" }, deps)).columns.map((c) => c.stage)).toEqual(["fora_do_perfil"]);
    expect((await listLeads(dono, { sessionId: "s_d", q: "Dois" }, deps)).total).toBe(1);
    expect((await listLeads(dono, { sessionId: "s_d", from: "2099-01-01" }, deps)).total).toBe(0);
    // RLS: o outro workspace não vê lead nenhum.
    expect((await listLeads(outro, {}, deps)).total).toBe(0);
  });

  it("o dono muda o estágio na mão (vence o agente), devolve pro agente, e o histórico guarda quem", async () => {
    const v = await setLeadStage(dono, "v2", { stage: "qualificado", reason: "fechou reunião por telefone" }, deps);
    expect(v).toMatchObject({ stage: "qualificado", stageManual: true, stageReason: "fechou reunião por telefone" });
    expect(v.history[0]).toMatchObject({ from: null, to: "qualificado", manual: true, byUser: true });
    // O agente não sobrescreve sem fato novo (mesmo store do motor).
    const ctx = await store().carregarContexto("v2");
    expect(ctx?.conversation.lead).toMatchObject({ estagio: "qualificado", manual: true });
    await expect(setLeadStage(dono, "v2", { stage: "inventado" }, deps)).rejects.toMatchObject({ code: "invalid_stage" });
    await expect(setLeadStage(outro, "v2", { stage: "novo" }, deps)).rejects.toMatchObject({ code: "not_found" });
    const solto = await releaseLeadStage(dono, "v2", deps);
    expect(solto.stageManual).toBe(false);
  });

  it("ficha editada pelo dono vale como confirmada e recalcula o estágio pelas regras", async () => {
    const v = await editLeadFicha(dono, "v3", { fields: { local_da_obra: "Hortolândia/SP", nome: "Bruno" } }, deps);
    const campo = v.fields.find((f) => f.key === "local_da_obra");
    expect(campo).toMatchObject({ value: "Hortolândia/SP", origin: "dono" });
    expect(v.stage).toBe("fora_do_perfil");
    expect(v.stageReason).toContain("Hortolândia/SP");
    expect(v.history[0]).toMatchObject({ to: "fora_do_perfil", manual: false, byUser: false });
    await expect(editLeadFicha(outro, "v3", { fields: { nome: "x" } }, deps)).rejects.toMatchObject({ code: "not_found" });
  });

  it("Conversas mostra o selo do estágio e filtra; a conversa traz a ficha", async () => {
    const lista = await listConversations(dono, { stage: "fora_do_perfil" }, deps);
    expect(lista.map((c) => c.id).sort()).toEqual(["v1", "v3"]);
    expect(lista.every((c) => c.stage === "fora_do_perfil")).toBe(true);
    const t = await getThread(dono, "v1", deps);
    expect(t.lead?.stage).toBe("fora_do_perfil");
    expect(t.lead?.fields.find((f) => f.key === "local_da_obra")).toMatchObject({ value: "Sumaré/SP", origin: "confirmado", note: "fora da área", messageId: "m1" });
    expect(t.lead?.stages.find((s) => s.key === "qualificado")?.name).toBe("Pronto pra reunião");
  });

  it("CSV dos leads e do histórico (sem texto de mensagem, com proteção de fórmula)", async () => {
    const leads = await exportLeadsCsv(dono, { sessionId: "s_d" }, deps);
    expect(leads.split("\r\n")[0]).toContain("contact,phone,number,stage,reason,manual,summary,last_message_at");
    expect(leads).toContain("fora_do_perfil");
    expect(leads).not.toContain("quero reformar meu apartamento");
    const hist = await exportLeadsCsv(dono, { sessionId: "s_d", kind: "history" }, deps);
    expect(hist).toContain("fechou reunião por telefone");
    expect(hist).toContain(",team");
    expect(await exportLeadsCsv(outro, { kind: "history" }, deps)).toBe("﻿date,contact,phone,from,to,reason,kind,changed_by\r\n");
  });
});

describe("resposta pelo inbox vira exemplo do negócio", () => {
  it("o dono responde no lugar do agente: guarda o par sem dado pessoal e pausa o agente", async () => {
    await db.exec(`DELETE FROM whatsapp."WaAgentExample"`);
    const r = await sendReply(dono, "v3", { text: "Fazemos sim! Me chama no (19) 97777-6666 que a gente marca uma reunião." }, deps);
    expect(r.queued).toBe(true);
    const ex = await withRls(dono, (tx) => tx.waAgentExample.findMany(), prisma);
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ origem: "assumir", pergunta: "vocês fazem orçamento de graça?" });
    expect(ex[0].resposta).toContain("[telefone]");
    expect(ex[0].resposta).not.toContain("97777");
    expect(await withRls(outro, (tx) => tx.waAgentExample.count(), prisma)).toBe(0);
    const regras = lerRegras((await withRls(dono, (tx) => tx.waAgentProfile.findFirst(), prisma))?.regrasNegocio);
    expect(regras.cidadesAtendidas).toHaveLength(2);
  });
});
