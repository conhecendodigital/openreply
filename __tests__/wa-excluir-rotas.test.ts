/**
 * Rota DELETE /api/whatsapp/sessions/[id] (Excluir número): só dono ou admin
 * do workspace; membro comum 403; chave de API/MCP 403 (aqui e no proxy.ts);
 * sem login 401. A regra de negócio fica em lib/whatsapp/painel-excluir.ts
 * (testada no Postgres em wa-excluir-numero.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  context: vi.fn(),
  caller: vi.fn(),
  del: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: h.context,
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));
vi.mock("@/lib/auth", () => ({ getApiCaller: h.caller }));
vi.mock("@/lib/db/client", () => ({ prisma: {}, getPrisma: () => ({}) }));
vi.mock("@/lib/whatsapp/queue", () => ({ bullmqWaQueue: {} }));
vi.mock("@/lib/whatsapp/setup", () => ({ getWaRepository: () => ({}), webhookUrl: () => null, uazapiWebhookUrl: () => null, whatsappStatus: () => ({}) }));
vi.mock("@/lib/whatsapp/painel-excluir", () => ({ deleteSession: h.del, listRemovedSessions: vi.fn(async () => []) }));
vi.mock("@/lib/whatsapp/painel", async (orig) => ({
  ...(await orig<typeof import("../lib/whatsapp/painel")>()),
  disconnectSession: h.disconnect,
}));

import * as sessionRoute from "../app/api/whatsapp/sessions/[id]/route";
import * as disconnectRoute from "../app/api/whatsapp/sessions/[id]/disconnect/route";
import { isApiKeyRouteAllowed } from "../lib/api-key-routes";
import { PainelError } from "../lib/whatsapp/painel";

const CTX = { userId: "u_m", workspaceId: "ws_m", workspace: { id: "ws_m" }, role: "OWNER" };
const params = { params: Promise.resolve({ id: "s1" }) };
const delReq = (body: unknown) =>
  new NextRequest(new URL("http://localhost/api/whatsapp/sessions/s1"), { method: "DELETE", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  h.context.mockResolvedValue(CTX);
  h.caller.mockResolvedValue({ kind: "session" });
  h.del.mockResolvedValue({ deleted: true, mode: "number_only", providerOk: true, provider: "OPENWA", providerRef: "owa-1", label: "Loja" });
  h.disconnect.mockResolvedValue({ session: { id: "s1", status: "DISCONNECTED" }, gatewayOk: true });
});

describe("DELETE /api/whatsapp/sessions/[id]", () => {
  it("dono exclui: manda o modo e o nome digitado pra regra", async () => {
    const res = await sessionRoute.DELETE(delReq({ mode: "number_and_conversations", confirmName: "Loja", extra: "ignorado" }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ deleted: true, providerOk: true });
    expect(h.del).toHaveBeenCalledWith({ userId: "u_m", workspaceId: "ws_m" }, "s1", { mode: "number_and_conversations", confirmName: "Loja" }, expect.anything());
  });

  it("admin do workspace também exclui", async () => {
    h.context.mockResolvedValueOnce({ ...CTX, role: "ADMIN" });
    expect((await sessionRoute.DELETE(delReq({ mode: "number_only" }), params)).status).toBe(200);
  });

  it("membro comum 403, sem login 401, chave de API 403: nada é excluído", async () => {
    h.context.mockResolvedValueOnce({ ...CTX, role: "MEMBER" });
    expect((await sessionRoute.DELETE(delReq({ mode: "number_only" }), params)).status).toBe(403);
    h.context.mockResolvedValueOnce(null);
    expect((await sessionRoute.DELETE(delReq({ mode: "number_only" }), params)).status).toBe(401);
    h.caller.mockResolvedValueOnce({ kind: "token", tokenId: "tok", scopes: [] });
    const key = await sessionRoute.DELETE(delReq({ mode: "number_only" }), params);
    expect(key.status).toBe(403);
    expect((await key.json()).details).toMatchObject({ code: "human_only" });
    expect(h.del).not.toHaveBeenCalled();
  });

  it("o proxy nunca deixa chave de API chegar nas rotas do WhatsApp", () => {
    expect(isApiKeyRouteAllowed("DELETE", "/api/whatsapp/sessions/s1")).toBe(false);
    expect(isApiKeyRouteAllowed("GET", "/api/whatsapp/sessions")).toBe(false);
  });

  it("erro da regra vira mensagem simples (sem stack)", async () => {
    h.del.mockRejectedValueOnce(new PainelError("confirm_name", "Type the name of the number exactly as it shows to confirm.", 400));
    const res = await sessionRoute.DELETE(delReq({ mode: "number_and_conversations", confirmName: "x" }), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, details: { code: "confirm_name" } });
  });

  it("Desconectar continua na rota dele e não chama a exclusão", async () => {
    const res = await disconnectRoute.POST(new NextRequest("http://localhost/x", { method: "POST" }), params);
    expect(res.status).toBe(200);
    expect(h.disconnect).toHaveBeenCalledTimes(1);
    expect(h.del).not.toHaveBeenCalled();
  });
});
