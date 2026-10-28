/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 28/10/2026: publicar_fluxo, ligar_fluxo, desligar_fluxo, ativar_automacao e desativar_automacao
 * pela chave (MCP), a pedido do dono. As rotas da tela seguem human_only para chave.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => {
  const models = new Map<string, Record<string, ReturnType<typeof vi.fn>>>();
  const model = (name: string) => {
    if (!models.has(name)) {
      models.set(
        name,
        new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
          get(target, method: string) {
            if (!target[method]) target[method] = vi.fn(async () => null);
            return target[method];
          },
        })
      );
    }
    return models.get(name)!;
  };
  const prisma = new Proxy({} as Record<string, unknown>, {
    get(_t, name: string) {
      if (name === "$transaction") return vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
      return model(name);
    },
  });
  return {
    prisma: prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>,
    models,
    mockContext: vi.fn(),
    mockCaller: vi.fn(),
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: h.mockContext,
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));
vi.mock("@/lib/auth", () => ({ getApiCaller: h.mockCaller }));

import * as pubRoute from "../app/api/mcp-fluxos/[id]/publish/route";
import * as onRoute from "../app/api/mcp-fluxos/[id]/ligar/route";
import * as offRoute from "../app/api/mcp-fluxos/[id]/desligar/route";
import * as campOn from "../app/api/mcp-automacoes/[id]/ligar/route";
import * as campOff from "../app/api/mcp-automacoes/[id]/desligar/route";
import * as screenPublish from "../app/api/flows/[id]/publish/route";
import * as screenActive from "../app/api/flows/[id]/active/route";
import { handleMcpMessage, TOOLS, type InternalCall } from "../lib/mcp/server";
import { resolveHandler } from "../lib/mcp/routes";
import { isApiKeyRouteAllowed } from "../lib/api-key-routes";

const CTX = { userId: "u_A", workspaceId: "ws_A", workspace: { id: "ws_A" }, role: "OWNER" };
const KEY = { kind: "token", tokenId: "tok_1", scopes: [] };
const req = (path: string, body?: unknown) =>
  new NextRequest(new URL(path, "http://localhost"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const def = (over: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  trigger: { type: "COMMENT", postId: "post_1", keywords: ["EU"], matchAnyWord: false, wholeWordMatch: true, matchAnyPost: false, next: "m1", ...over },
  nodes: [
    { id: "m1", type: "message", text: "Oi {first_name}", buttons: [{ id: "l1", kind: "link", label: "Site", url: "https://example.com" }], next: "fim" },
    { id: "fim", type: "end" },
  ],
});

type FlowState = Record<string, any>;
let flows: FlowState[] = [];
let autos: Record<string, any>[] = [];

function flowRow(over: FlowState = {}): FlowState {
  return {
    id: "f_1", workspaceId: "ws_A", name: "Fluxo 1", isActive: false, instagramAccountId: "acc_1",
    draft: def(), published: null, publishedVersion: 0, publishedAt: null, triggerType: null,
    triggerPostId: null, triggerMatchAnyPost: false, triggerStoryId: null, conversationLinkId: null,
    keywords: [], matchAnyWord: false, wholeWordMatch: true,
    sourceAutomationId: null, enteredCount: 0, completedCount: 0, createdAt: new Date(), updatedAt: new Date(),
    instagramAccount: { username: "omatheus.ai", status: "ACTIVE" }, ...over,
  };
}
/** Fluxo já publicado e (opcional) ligado no gatilho padrão. */
const published = (over: FlowState = {}) =>
  flowRow({ published: def(), publishedVersion: 1, triggerType: "COMMENT", triggerPostId: "post_1", keywords: ["EU"], ...over });
const auto = (over: Record<string, any> = {}) => ({
  id: "a_1", workspaceId: "ws_A", instagramAccountId: "acc_1", name: "Campanha EU", isActive: false, trigger: "COMMENT",
  postId: "post_1", matchAnyPost: false, storyId: null, keywords: ["eu"], matchAnyWord: false, wholeWordMatch: true, dmTriggerEnabled: false, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.MCP_FLUXOS_DISABLED;
  for (const m of h.models.values()) for (const k of Object.keys(m)) delete m[k];
  flows = [];
  autos = [];
  h.mockContext.mockResolvedValue(CTX);
  h.mockCaller.mockResolvedValue(KEY);
  h.prisma.flow.findFirst.mockImplementation(async ({ where }: any) => flows.find((f) => f.id === where.id && f.workspaceId === where.workspaceId) ?? null);
  h.prisma.flow.findMany.mockImplementation(async ({ where }: any) => flows.filter((f) => f.instagramAccountId === where.instagramAccountId && f.isActive === where.isActive));
  h.prisma.flow.update.mockImplementation(async ({ where, data }: any) => {
    const f = flows.find((x) => x.id === where.id)!;
    const { publishedVersion, ...rest } = data;
    Object.assign(f, rest);
    if (publishedVersion?.increment) f.publishedVersion += publishedVersion.increment;
    return { ...f };
  });
  h.prisma.automation.findFirst.mockImplementation(async ({ where }: any) => autos.find((a) => a.id === where.id && a.workspaceId === where.workspaceId) ?? null);
  h.prisma.automation.findMany.mockImplementation(async ({ where }: any) => autos.filter((a) => a.instagramAccountId === where.instagramAccountId && a.isActive === where.isActive));
  h.prisma.automation.update.mockImplementation(async ({ where, data }: any) => Object.assign(autos.find((a) => a.id === where.id)!, data));
  h.prisma.operationalEvent.create.mockResolvedValue({});
});

const pub = (id = "f_1") => pubRoute.POST(req(`/api/mcp-fluxos/${id}/publish`, {}), params(id));
const on = (id = "f_1", body: unknown = {}) => onRoute.POST(req(`/api/mcp-fluxos/${id}/ligar`, body), params(id));
const off = (id = "f_1") => offRoute.POST(req(`/api/mcp-fluxos/${id}/desligar`, {}), params(id));
const audits = () => h.prisma.operationalEvent.create.mock.calls.map((c) => c[0].data);

describe("publicar_fluxo", () => {
  it("publica rascunho válido, lido do banco, e audita sem conteúdo", async () => {
    flows = [flowRow()];
    const res = await pub();
    expect(res.status).toBe(200);
    const d = (await res.json()).data;
    expect(d).toMatchObject({ conferencia: "CONFERE", nome: "Fluxo 1", publicado: true, versao: 1, ligado: false });
    expect(d.gatilho.type).toBe("COMMENT");
    expect(flows[0].triggerType).toBe("COMMENT");
    expect(audits()).toHaveLength(1);
    expect(audits()[0].payload).toMatchObject({ tokenId: "tok_1", tipo: "fluxo", itemId: "f_1" });
    expect(JSON.stringify(audits()[0])).not.toContain("Oi {first_name}");
  });

  it("inválido: recusa, devolve o que falta e não muda nada", async () => {
    flows = [flowRow({ draft: { schemaVersion: 1, trigger: { type: "DM", keywords: [], next: "x" }, nodes: [] } })];
    const res = await pub();
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toContain("oQueFalta");
    expect(flows[0].published).toBeNull();
    expect(flows[0].publishedVersion).toBe(0);
    expect(audits()).toHaveLength(0);
  });

  it("idempotente: sem mudanças não cria versão nova nem audita", async () => {
    flows = [flowRow()];
    await pub();
    const res = await pub();
    expect((await res.json()).data).toMatchObject({ conferencia: "CONFERE", versao: 1, aviso: expect.stringContaining("Nada foi alterado") });
    expect(flows[0].publishedVersion).toBe(1);
    expect(audits()).toHaveLength(1);
  });

  it("com mudança no rascunho, sobe a versão", async () => {
    flows = [flowRow()];
    await pub();
    flows[0].draft = def({ keywords: ["QUERO"] });
    const d = (await (await pub()).json()).data;
    expect(d.versao).toBe(2);
  });

  it("NÃO CONFERE quando o banco diverge", async () => {
    flows = [flowRow()];
    let reads = 0;
    h.prisma.flow.findFirst.mockImplementation(async () => (reads++ === 0 ? { ...flows[0] } : { ...flows[0], publishedVersion: 99 }));
    expect((await (await pub()).json()).data.conferencia).toBe("NÃO CONFERE");
  });

  it("fluxo de outro workspace: 404 e nada muda", async () => {
    flows = [flowRow({ workspaceId: "ws_B" })];
    expect((await pub()).status).toBe(404);
    expect((await on()).status).toBe(404);
    expect(flows[0].published).toBeNull();
  });
});

describe("ligar_fluxo / desligar_fluxo", () => {
  it("só liga fluxo publicado", async () => {
    flows = [flowRow()];
    const res = await on();
    expect(res.status).toBe(409);
    expect(flows[0].isActive).toBe(false);
  });

  it("liga, confere, audita e é idempotente; desliga sem apagar", async () => {
    flows = [published()];
    const d = (await (await on()).json()).data;
    expect(d).toMatchObject({ conferencia: "CONFERE", ligado: true, publicado: true, versao: 1 });
    expect(audits().map((a) => a.message)).toEqual(["MCP: fluxo ligado"]);
    const again = (await (await on()).json()).data;
    expect(again.aviso).toContain("Já estava ligado");
    expect(audits()).toHaveLength(1);
    const offd = (await (await off()).json()).data;
    expect(offd).toMatchObject({ conferencia: "CONFERE", ligado: false });
    expect(flows).toHaveLength(1);
    expect(h.prisma.flow.delete).not.toHaveBeenCalled();
    expect((await (await off()).json()).data.aviso).toContain("Já estava desligado");
  });

  it("conflito de gatilho sem desligarConflitantes: não liga e lista fluxo e campanha", async () => {
    flows = [published({ id: "f_1" }), published({ id: "f_2", name: "Fluxo 2", isActive: true })];
    autos = [auto({ isActive: true })];
    const res = await on("f_1");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.details.code).toBe("gatilho_duplicado");
    expect(body.details.conflitantes.map((c: any) => `${c.tipo}:${c.id}`).sort()).toEqual(["campanha:a_1", "fluxo:f_2"]);
    expect(flows[0].isActive).toBe(false);
    expect(flows[1].isActive).toBe(true);
    expect(autos[0].isActive).toBe(true);
  });

  it("com desligarConflitantes:true desliga (nunca apaga), audita cada um e liga o novo", async () => {
    flows = [published({ id: "f_1" }), published({ id: "f_2", name: "Fluxo 2", isActive: true })];
    autos = [auto({ isActive: true })];
    const res = await on("f_1", { desligarConflitantes: true });
    const d = (await res.json()).data;
    expect(d).toMatchObject({ conferencia: "CONFERE", ligado: true });
    expect(d.desligadosPorConflito).toHaveLength(2);
    expect(flows[1].isActive).toBe(false);
    expect(autos[0].isActive).toBe(false);
    expect(autos).toHaveLength(1);
    expect(h.prisma.flow.delete).not.toHaveBeenCalled();
    expect(h.prisma.automation.delete).not.toHaveBeenCalled();
    expect(audits().map((a) => a.payload.itemId).sort()).toEqual(["a_1", "f_1", "f_2"]);
  });

  it("gatilhos diferentes (outro post ou outra palavra) não conflitam", async () => {
    flows = [published({ id: "f_1" }), published({ id: "f_2", isActive: true, triggerPostId: "post_9" })];
    autos = [auto({ isActive: true, keywords: ["outra"] })];
    expect((await on("f_1")).status).toBe(200);
  });
});

describe("ativar_automacao / desativar_automacao (campanha)", () => {
  it("liga, confere, audita, idempotente; desliga sem apagar", async () => {
    autos = [auto()];
    const d = (await (await campOn.POST(req("/x", {}), params("a_1"))).json()).data;
    expect(d).toMatchObject({ conferencia: "CONFERE", ligada: true, nome: "Campanha EU" });
    expect(audits()[0].message).toBe("MCP: campanha ligada");
    expect((await (await campOn.POST(req("/x", {}), params("a_1"))).json()).data.aviso).toContain("Já estava ligada");
    const o = (await (await campOff.POST(req("/x", {}), params("a_1"))).json()).data;
    expect(o).toMatchObject({ conferencia: "CONFERE", ligada: false });
    expect(autos).toHaveLength(1);
  });

  it("conflito com fluxo ligado no mesmo post: avisa; com desligarConflitantes desliga o fluxo", async () => {
    autos = [auto()];
    flows = [published({ isActive: true })];
    const blocked = await campOn.POST(req("/x", {}), params("a_1"));
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).details.conflitantes[0]).toMatchObject({ tipo: "fluxo", id: "f_1" });
    expect(autos[0].isActive).toBe(false);
    const ok = await campOn.POST(req("/x", { desligarConflitantes: true }), params("a_1"));
    expect((await ok.json()).data.conferencia).toBe("CONFERE");
    expect(flows[0].isActive).toBe(false);
    expect(autos[0].isActive).toBe(true);
  });

  it("campanha de outro workspace: 404", async () => {
    autos = [auto({ workspaceId: "ws_B" })];
    expect((await campOn.POST(req("/x", {}), params("a_1"))).status).toBe(404);
  });
});

describe("travas e interruptor", () => {
  it("MCP_FLUXOS_DISABLED=1 desliga todas as cinco, com mensagem em português, sem tocar no banco", async () => {
    process.env.MCP_FLUXOS_DISABLED = "1";
    flows = [published()];
    autos = [auto()];
    for (const res of [await pub(), await on(), await off(), await campOn.POST(req("/x", {}), params("a_1")), await campOff.POST(req("/x", {}), params("a_1"))]) {
      expect(res.status).toBe(503);
      expect(JSON.stringify(await res.json())).toContain("desligado");
    }
    expect(h.prisma.flow.update).not.toHaveBeenCalled();
    expect(h.prisma.automation.update).not.toHaveBeenCalled();
    expect(audits()).toHaveLength(0);
  });

  it("sessão de pessoa nas rotas do MCP: 403; sem login: 401", async () => {
    flows = [published()];
    h.mockCaller.mockResolvedValue({ kind: "session" });
    expect((await on()).status).toBe(403);
    h.mockContext.mockResolvedValue(null);
    expect((await on()).status).toBe(401);
  });

  it("rotas da TELA seguem 403 human_only para chave (publicar e ligar)", async () => {
    flows = [flowRow()];
    const p = await screenPublish.POST(req("/api/flows/f_1/publish"), params("f_1"));
    expect(p.status).toBe(403);
    expect((await p.json()).details.code).toBe("human_only");
    const a = await screenActive.POST(req("/api/flows/f_1/active", { isActive: true }), params("f_1"));
    expect(a.status).toBe(403);
    expect(flows[0].published).toBeNull();
    expect(flows[0].isActive).toBe(false);
  });

  it("a tela (sessão) continua publicando com a mesma regra", async () => {
    flows = [flowRow()];
    h.mockCaller.mockResolvedValue({ kind: "session" });
    const res = await screenPublish.POST(req("/api/flows/f_1/publish"), params("f_1"));
    expect(res.status).toBe(200);
    expect(flows[0].publishedVersion).toBe(1);
  });

  it("roteador e lista da chave concordam; nada apaga", () => {
    for (const path of ["/api/mcp-fluxos/f/publish", "/api/mcp-fluxos/f/ligar", "/api/mcp-fluxos/f/desligar", "/api/mcp-automacoes/a/ligar", "/api/mcp-automacoes/a/desligar"]) {
      expect(resolveHandler("POST", path)).not.toBeNull();
      expect(isApiKeyRouteAllowed("POST", path)).toBe(true);
      expect(isApiKeyRouteAllowed("DELETE", path)).toBe(false);
    }
    expect(isApiKeyRouteAllowed("POST", "/api/flows/f/publish")).toBe(false); // a rota da tela nem passa do proxy para chave
    expect(TOOLS.map((t) => t.name).filter((n) => /apagar|deletar|excluir/.test(n) && /fluxo|automacao/.test(n))).toEqual([]);
  });

  it("as ferramentas passam pelo JSON-RPC e chamam as rotas certas", async () => {
    const calls: [string, string, unknown][] = [];
    const call: InternalCall = async (m, p, b) => {
      calls.push([m, p, b]);
      return { status: 200, json: { success: true, data: { conferencia: "CONFERE" } } };
    };
    const t = (name: string, args: Record<string, unknown>, id: number) =>
      handleMcpMessage({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }, call);
    await t("publicar_fluxo", { id: "f_1" }, 1);
    await t("ligar_fluxo", { id: "f_1", desligarConflitantes: true }, 2);
    await t("desligar_fluxo", { id: "f_1" }, 3);
    await t("ativar_automacao", { id: "a_1" }, 4);
    await t("desativar_automacao", { id: "a_1" }, 5);
    expect(calls.map((c) => c[1])).toEqual([
      "/api/mcp-fluxos/f_1/publish", "/api/mcp-fluxos/f_1/ligar", "/api/mcp-fluxos/f_1/desligar",
      "/api/mcp-automacoes/a_1/ligar", "/api/mcp-automacoes/a_1/desligar",
    ]);
    expect(calls[1][2]).toEqual({ desligarConflitantes: true });
    expect(calls[3][2]).toEqual({ desligarConflitantes: false });
  });
});
