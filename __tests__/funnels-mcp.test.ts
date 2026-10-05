/**
 * Etapa 6: ferramentas MCP do quiz. Criam e editam RASCUNHO, nunca publicam;
 * a chave de API não alcança publish / unpublish / leads (nem a rota no MCP
 * nem a lista do proxy).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({ getApiCaller: vi.fn(), getCurrentWorkspaceId: vi.fn() }));
vi.mock("@/lib/workspace-access", () => ({ getCurrentWorkspaceContext: vi.fn(), canManageWorkspace: () => true }));

import { handleMcpMessage, TOOLS, type InternalCall } from "../lib/mcp/server";
import { FUNNEL_TOOLS, issueTextPt } from "../lib/mcp/funnel-tools";
import { resolveHandler } from "../lib/mcp/routes";
import { isApiKeyRouteAllowed } from "../lib/api-key-routes";
import { getFunnelTemplate } from "../lib/funnels/templates";
import { validateFunnel } from "../lib/funnels/validate";

const NAMES = ["listar_funis", "ver_funil", "listar_modelos_funil", "criar_funil", "duplicar_modelo", "editar_funil", "ver_resultados_funil"];

describe("ferramentas MCP do quiz", () => {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const draft = getFunnelTemplate("escada-sim-vsl")!.build();
  const detail = {
    id: "f_1",
    name: "Chat Sem Frescura",
    slug: "chat-sem-frescura",
    status: "DRAFT",
    stepCount: 6,
    publishedVersion: 0,
    hasUnpublishedChanges: false,
    draft,
    published: null,
    validation: validateFunnel(draft),
  };
  const fake: InternalCall = async (method, path, body) => {
    calls.push({ method, path, body });
    if (path === "/api/funnels" && method === "GET") return { status: 200, json: { success: true, data: [{ ...detail, stats: { visits7d: 3, checkouts7d: 1, leads7d: 0 } }] } };
    if (path.includes("/results")) {
      return {
        status: 200,
        json: {
          success: true,
          data: {
            days: 7,
            source: "instagram",
            totals: { visits: 10, started: 5, completed: 2, checkouts: 1, leads: 0, purchases: 1, refunds: 0 },
            steps: [{ stepId: "s_capa", title: "Capa", index: 0, views: 10, pctOfFirst: 100, dropFromPrev: 0 }],
            answers: [],
            sources: [{ source: "instagram", visits: 10, checkouts: 1, purchases: 1 }],
          },
        },
      };
    }
    return { status: 200, json: { success: true, data: detail } };
  };
  const callTool = async (name: string, args: Record<string, unknown>) => {
    const res = (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, fake)) as {
      result: { content: { text: string }[]; isError?: boolean };
    };
    return { ...res.result, json: JSON.parse(res.result.content[0].text) };
  };

  beforeEach(() => {
    calls.length = 0;
  });

  it("tools/list tem as 7 e nenhuma publica", async () => {
    const list = (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, fake)) as { result: { tools: { name: string }[] } };
    const names = list.result.tools.map((t) => t.name);
    for (const n of NAMES) expect(names).toContain(n);
    expect(FUNNEL_TOOLS.map((t) => t.name)).toEqual(NAMES);
    expect(TOOLS.filter((t) => /funi|funnel/.test(t.name)).every((t) => !/publicar|publish|apagar|delete|leads|exportar/i.test(t.name))).toBe(true);
    expect(FUNNEL_TOOLS.some((t) => /publicar|publish/i.test(t.name))).toBe(false);
  });

  it("duplicar_modelo escada-sim-vsl + 'Chat Sem Frescura' chama POST /api/funnels e devolve DRAFT", async () => {
    const res = await callTool("duplicar_modelo", { modelo: "escada-sim-vsl", nome: "Chat Sem Frescura", slug: "chat-sem-frescura" });
    expect(calls).toEqual([
      { method: "POST", path: "/api/funnels", body: { name: "Chat Sem Frescura", templateId: "escada-sim-vsl", slug: "chat-sem-frescura" } },
    ]);
    expect(res.json).toMatchObject({ criado: true, status: "DRAFT", publicado: false, telas: 6, aviso: "Publicar só pela tela, com o dono da conta." });
    expect(res.json.oQueFaltaPraPublicar.podePublicar).toBe(false);
    const msgs: string[] = res.json.oQueFaltaPraPublicar.erros.map((e: { mensagem: string }) => e.mensagem);
    expect(msgs.some((m) => m.startsWith("Troque o texto entre colchetes"))).toBe(true);
    expect(msgs.some((m) => m.startsWith("Preencha o preço"))).toBe(true);
  });

  it("duplicar_modelo com id de funil copia pela rota duplicate", async () => {
    await callTool("duplicar_modelo", { modelo: "f_9", nome: "Cópia" });
    expect(calls[0]).toEqual({ method: "POST", path: "/api/funnels/f_9/duplicate", body: { name: "Cópia" } });
  });

  it("criar, ver, editar, listar e resultados nunca chamam publish", async () => {
    await callTool("criar_funil", { nome: "Novo", modelo: "quiz-diagnostico", status: "PUBLISHED" });
    const ver = await callTool("ver_funil", { id: "f_1" });
    const editar = await callTool("editar_funil", {
      id: "f_1",
      alteracoes: [{ stepId: "s_capa", blockId: "b_capa_titulo", set: { text: "Descubra como usar o Chat sem frescura" } }],
      status: "PUBLISHED",
    });
    await callTool("listar_funis", {});
    const numeros = await callTool("ver_resultados_funil", { id: "f_1", dias: 7, origem: "instagram" });
    expect(numeros.json.totais).toMatchObject({ visitantes: 10, compras: 1 });
    expect(numeros.json.porTela[0]).toMatchObject({ tela: 1, visitas: 10 });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "POST /api/funnels",
      "GET /api/funnels/f_1",
      "PATCH /api/funnels/f_1",
      "GET /api/funnels",
      "GET /api/funnels/f_1/results?days=7&source=instagram",
    ]);
    expect(calls[0].body).toEqual({ name: "Novo", templateId: "quiz-diagnostico" });
    expect(calls[2].body).toEqual({ patches: [{ stepId: "s_capa", blockId: "b_capa_titulo", set: { text: "Descubra como usar o Chat sem frescura" } }] });
    expect(ver.json.previa).toMatch(/\/q\/chat-sem-frescura\?preview=1$/);
    expect(editar.json).toMatchObject({ editado: true, status: "DRAFT", publicadoContinuaNoAr: false });
    expect(calls.some((c) => /publish|leads/.test(c.path))).toBe(false);
  });

  it("listar_modelos_funil traz nome PT e nº de telas", async () => {
    const res = await callTool("listar_modelos_funil", {});
    expect(res.json[0]).toMatchObject({ id: "escada-sim-vsl", nome: "Escada de sim + VSL", telas: 6 });
    expect(calls).toHaveLength(0);
  });

  it("modelo escada-sim-vsl fica válido no zod (só falta dado real)", () => {
    const v = validateFunnel(getFunnelTemplate("escada-sim-vsl")!.build());
    expect(v.errors.every((e) => ["placeholder_left", "offer_no_price", "compare_not_authorized", "checkout_no_url", "guarantee_no_days"].includes(e.code))).toBe(true);
    expect(issueTextPt({ code: "offer_no_price", level: "error", params: { step: "Oferta" } })).toBe("Preencha o preço da oferta da tela Oferta");
  });

  it("instructions citam o quiz como rascunho", async () => {
    const init = (await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, fake)) as { result: { instructions: string } };
    expect(init.result.instructions).toContain("Quiz (funis): pela chave você cria e edita RASCUNHO; publicar é só pela tela");
  });
});

describe("rotas da chave", () => {
  it("resolveHandler acha as 4 rotas e não acha publish/unpublish/leads", () => {
    expect(resolveHandler("GET", "/api/funnels")).not.toBeNull();
    expect(resolveHandler("POST", "/api/funnels")).not.toBeNull();
    expect(resolveHandler("GET", "/api/funnels/x")).toMatchObject({ id: "x", param: "id" });
    expect(resolveHandler("PATCH", "/api/funnels/x")).not.toBeNull();
    expect(resolveHandler("POST", "/api/funnels/x/duplicate")).toMatchObject({ id: "x" });
    expect(resolveHandler("GET", "/api/funnels/x/results")).toMatchObject({ id: "x" });
    for (const p of ["/api/funnels/x/publish", "/api/funnels/x/unpublish", "/api/funnels/x/leads", "/api/funnels/x/leads/export"]) {
      expect(resolveHandler("POST", p), p).toBeNull();
      expect(resolveHandler("GET", p), p).toBeNull();
    }
    // DELETE existe na rota, mas ela mesma responde 403 human_only pra chave
    // (funnels-routes.test.ts) e o proxy barra DELETE de chave.
  });

  it("isApiKeyRouteAllowed: rascunho sim, publicar/despublicar/leads/apagar não", () => {
    expect(isApiKeyRouteAllowed("POST", "/api/funnels")).toBe(true);
    expect(isApiKeyRouteAllowed("PATCH", "/api/funnels/x")).toBe(true);
    expect(isApiKeyRouteAllowed("POST", "/api/funnels/x/duplicate")).toBe(true);
    expect(isApiKeyRouteAllowed("GET", "/api/funnels/x/results")).toBe(true);
    expect(isApiKeyRouteAllowed("POST", "/api/funnels/x/publish")).toBe(false);
    expect(isApiKeyRouteAllowed("POST", "/api/funnels/x/unpublish")).toBe(false);
    expect(isApiKeyRouteAllowed("GET", "/api/funnels/x/leads")).toBe(false);
    expect(isApiKeyRouteAllowed("GET", "/api/funnels/x/leads/export")).toBe(false);
    expect(isApiKeyRouteAllowed("DELETE", "/api/funnels/x")).toBe(false);
  });
});
