/**
 * WhatsApp pela chave de API (MCP): os 6 GET de leitura aceitam chave
 * (withPainelLeitura); os POST das mesmas rotas continuam 403 human_only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  mockContext: vi.fn(),
  mockCaller: vi.fn(),
  listConversations: vi.fn(),
  getThread: vi.fn(),
  listSessions: vi.fn(),
  serverStatus: vi.fn(),
  createSession: vi.fn(),
  listLeads: vi.fn(),
  listarProgramados: vi.fn(),
  adicionarProgramados: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: {} }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: h.mockContext,
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));
vi.mock("@/lib/auth", () => ({ getApiCaller: h.mockCaller }));
vi.mock("@/lib/whatsapp/queue", () => ({ bullmqWaQueue: {} }));
vi.mock("@/lib/whatsapp/setup", () => ({ getWaRepository: () => ({}) }));
vi.mock("@/lib/whatsapp/painel", async (orig) => ({
  ...(await orig<typeof import("@/lib/whatsapp/painel")>()),
  listConversations: h.listConversations,
  getThread: h.getThread,
  listSessions: h.listSessions,
  serverStatus: h.serverStatus,
  createSession: h.createSession,
}));
vi.mock("@/lib/whatsapp/painel-excluir", () => ({ listRemovedSessions: vi.fn(async () => []) }));
vi.mock("@/lib/whatsapp/regras/painel", () => ({ listLeads: h.listLeads }));
vi.mock("@/lib/whatsapp/programados", () => ({
  listarProgramados: h.listarProgramados,
  adicionarProgramados: h.adicionarProgramados,
  listarEnviados: vi.fn(),
}));

import * as conversationsRoute from "../app/api/whatsapp/conversations/route";
import * as conversationRoute from "../app/api/whatsapp/conversations/[id]/route";
import * as sessionsRoute from "../app/api/whatsapp/sessions/route";
import * as statusRoute from "../app/api/whatsapp/status/route";
import * as leadsRoute from "../app/api/whatsapp/leads/route";
import * as programadosRoute from "../app/api/whatsapp/programados/route";
import { isApiKeyRouteAllowed } from "../lib/api-key-routes";
import { resolveHandler } from "../lib/mcp/routes";
import { handleMcpMessage, TOOLS, type InternalCall } from "../lib/mcp/server";

const CTX = { userId: "u_A", workspaceId: "ws_A", workspace: { id: "ws_A" }, role: "OWNER" };
const TOKEN = { kind: "token", tokenId: "tok_1", scopes: [] };

const req = (path: string, method = "GET", body?: unknown) =>
  new NextRequest(new URL(path, "http://localhost"), {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.mockContext.mockResolvedValue(CTX);
  h.mockCaller.mockResolvedValue(TOKEN);
  h.listConversations.mockResolvedValue([]);
  h.getThread.mockResolvedValue({ messages: [] });
  h.listSessions.mockResolvedValue([]);
  h.serverStatus.mockResolvedValue({ enabled: true });
  h.listLeads.mockResolvedValue({ columns: [] });
  h.listarProgramados.mockResolvedValue({ itens: [] });
});

describe("WhatsApp leitura pela chave de API", () => {
  it("os 6 GET respondem 200 com chave", async () => {
    const idParams = { params: Promise.resolve({ id: "c_1" }) };
    const statuses = [
      (await conversationsRoute.GET(req("/api/whatsapp/conversations"))).status,
      (await conversationRoute.GET(req("/api/whatsapp/conversations/c_1"), idParams)).status,
      (await sessionsRoute.GET()).status,
      (await statusRoute.GET()).status,
      (await leadsRoute.GET(req("/api/whatsapp/leads"))).status,
      (await programadosRoute.GET(req("/api/whatsapp/programados"))).status,
    ];
    expect(statuses).toEqual([200, 200, 200, 200, 200, 200]);
  });

  it("GET sem login = 401, nada é lido", async () => {
    h.mockContext.mockResolvedValue(null);
    const res = await conversationsRoute.GET(req("/api/whatsapp/conversations"));
    expect(res.status).toBe(401);
    expect(h.listConversations).not.toHaveBeenCalled();
  });

  it("POST pela chave = 403 human_only, nada é conectado nem programado", async () => {
    const conectar = await sessionsRoute.POST(req("/api/whatsapp/sessions", "POST", { acceptRisk: true, displayName: "x" }));
    expect(conectar.status).toBe(403);
    expect(JSON.stringify(await conectar.json())).toContain("human_only");
    const programar = await programadosRoute.POST(
      req("/api/whatsapp/programados", "POST", { conversationId: "c_1", itens: [{ label: "R1", text: "oi" }] })
    );
    expect(programar.status).toBe(403);
    expect(h.createSession).not.toHaveBeenCalled();
    expect(h.adicionarProgramados).not.toHaveBeenCalled();
  });

  it("proxy: só os 6 GET entram pela chave; o resto do WhatsApp segue 403", () => {
    for (const p of [
      "/api/whatsapp/conversations",
      "/api/whatsapp/conversations/c_1",
      "/api/whatsapp/sessions",
      "/api/whatsapp/status",
      "/api/whatsapp/leads",
      "/api/whatsapp/programados",
    ]) {
      expect(isApiKeyRouteAllowed("GET", p), p).toBe(true);
      expect(resolveHandler("GET", p), p).not.toBeNull();
    }
    expect(resolveHandler("GET", "/api/whatsapp/conversations/c_1")?.id).toBe("c_1");
    for (const p of [
      "/api/whatsapp/conversations/c_1/messages",
      "/api/whatsapp/conversations/c_1/agent",
      "/api/whatsapp/agents",
      "/api/whatsapp/drafts",
      "/api/whatsapp/leads/export",
      "/api/whatsapp/programados/c_1",
    ]) {
      expect(isApiKeyRouteAllowed("GET", p), p).toBe(false);
    }
    for (const m of ["POST", "PATCH", "DELETE"]) {
      expect(isApiKeyRouteAllowed(m, "/api/whatsapp/sessions"), m).toBe(false);
      expect(isApiKeyRouteAllowed(m, "/api/whatsapp/programados"), m).toBe(false);
    }
  });
});

describe("ferramentas MCP de leitura do WhatsApp", () => {
  const run = async (name: string, args: Record<string, unknown>, data: unknown = {}) => {
    const call = vi.fn<InternalCall>(async () => ({ status: 200, json: { success: true, data } }));
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, call);
    return { call, out: JSON.parse((res?.result as { content: { text: string }[] }).content[0].text) };
  };

  it("existem as 6 e só chamam GET", async () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "listar_conversas_whatsapp",
        "ler_conversa_whatsapp",
        "ver_numeros_whatsapp",
        "ver_status_whatsapp",
        "listar_leads_whatsapp",
        "listar_programados_whatsapp",
      ])
    );
    const casos: [string, Record<string, unknown>, string][] = [
      ["listar_conversas_whatsapp", { q: "ana", filtro: "unread", tipo: "chats" }, "/api/whatsapp/conversations?q=ana&filter=unread&kind=chats"],
      ["listar_conversas_whatsapp", {}, "/api/whatsapp/conversations"],
      ["ler_conversa_whatsapp", { conversationId: "c_1" }, "/api/whatsapp/conversations/c_1"],
      ["ver_numeros_whatsapp", {}, "/api/whatsapp/sessions"],
      ["ver_status_whatsapp", {}, "/api/whatsapp/status"],
      ["listar_leads_whatsapp", { estagio: "quente", de: "2026-10-01" }, "/api/whatsapp/leads?stage=quente&from=2026-10-01"],
      ["listar_programados_whatsapp", { conversationId: "c_1" }, "/api/whatsapp/programados?conversationId=c_1"],
    ];
    for (const [name, args, path] of casos) {
      const { call } = await run(name, args);
      expect(call).toHaveBeenCalledWith("GET", path, undefined);
    }
  });

  it("ler_conversa_whatsapp corta nas últimas 50 mensagens", async () => {
    const messages = Array.from({ length: 120 }, (_, i) => ({ id: `m_${i}`, body: `msg ${i}` }));
    const { out } = await run("ler_conversa_whatsapp", { conversationId: "c_1" }, { lead: null, messages });
    expect(out.messages).toHaveLength(50);
    expect(out.messages[0].id).toBe("m_70");
    expect(out.messages[49].id).toBe("m_119");
    expect(out.mensagensOmitidas).toBe(70);
  });

  it("ler_conversa_whatsapp com poucas mensagens devolve tudo, sem aviso", async () => {
    const { out } = await run("ler_conversa_whatsapp", { conversationId: "c_1" }, { messages: [{ id: "m_1" }] });
    expect(out.messages).toHaveLength(1);
    expect(out.mensagensOmitidas).toBeUndefined();
  });
});
