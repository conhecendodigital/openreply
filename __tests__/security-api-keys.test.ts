/**
 * Revisão de segurança (04/10): o que uma chave de API (a chave do MCP da IA,
 * scripts) NÃO pode fazer, direto na API e não só no MCP.
 * - nunca liga campanha (PATCH isActive:true = 403 human_only; POST e import
 *   criam sempre desligado, seja o que for que venha no corpo);
 * - campanha LIGADA: só nome, objetivo e desligar (texto, link e gatilho = 409);
 * - não publica relatório, não apaga campanha/segmento/disparo/link;
 * - não mexe em membros (vira admin humano) nem vê link de convite;
 * - um admin não rebaixa o dono pelo convite;
 * - link de conversa: chave não liga link nem pendura campanha ligada;
 * - ativar_automacao do MCP não chama a API.
 * A pessoa logada (sessão) continua podendo tudo isso.
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
    byKey: false,
    role: "OWNER" as "OWNER" | "ADMIN" | "MEMBER",
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/auth", () => ({
  isApiTokenRequest: vi.fn(async () => h.byKey),
  getApiCaller: vi.fn(async () =>
    h.byKey ? { kind: "token", tokenId: "tok_ia", scopes: [] } : { kind: "session" }
  ),
  getCurrentWorkspaceId: vi.fn(async () => "ws"),
}));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => ({ workspaceId: "ws", userId: "u_owner", role: h.role })),
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));

import * as automations from "../app/api/automations/route";
import * as importRoute from "../app/api/automations/import/route";
import * as members from "../app/api/workspace/members/route";
import * as links from "../app/api/conversation-links/route";
import * as link from "../app/api/conversation-links/[id]/route";
import * as segment from "../app/api/segments/[id]/route";
import * as broadcast from "../app/api/broadcasts/[id]/route";
import { TOOLS, type InternalCall } from "../lib/mcp/server";

const db = h.prisma;

function req(path: string, method: string, body?: unknown) {
  return new NextRequest(new URL(path, "http://localhost"), {
    method,
    headers: { "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const campaign = (over: Record<string, unknown> = {}) => ({
  id: "auto_1",
  workspaceId: "ws",
  name: "Editor",
  goal: null,
  trigger: "COMMENT",
  postId: "p1",
  keywords: ["EDITOR"],
  matchAnyWord: false,
  matchAnyPost: false,
  pendingNextReel: false,
  dmTriggerEnabled: false,
  dmMessage: "Oi, segue o link",
  isActive: false,
  reportShareEnabled: false,
  ...over,
});

const newCampaign = { name: "Nova", postId: "p1", keywords: ["OI"], dmMessage: "Oi" };

beforeEach(() => {
  h.models.clear();
  h.byKey = false;
  h.role = "OWNER";
  db.workspace.findUnique.mockResolvedValue({ id: "ws" });
  db.instagramAccount.findFirst.mockResolvedValue({ id: "acc", workspaceId: "ws" });
  db.automation.create.mockImplementation(async (a: { data: Record<string, unknown> }) => ({ id: "auto_new", ...a.data }));
  db.automation.update.mockImplementation(async (a: { data: Record<string, unknown> }) => ({ id: "auto_1", ...a.data }));
  db.automation.findMany.mockResolvedValue([]);
  db.trackedLink.findMany.mockResolvedValue([]);
  db.workspaceMember.findMany.mockResolvedValue([]);
  db.workspaceInvitation.findMany.mockResolvedValue([]);
});

describe("campanha: chave de API nunca liga", () => {
  it("POST por chave cria DESLIGADA mesmo com isActive:true no corpo (e sem isActive)", async () => {
    h.byKey = true;
    expect((await automations.POST(req("/api/automations", "POST", { ...newCampaign, isActive: true }))).status).toBe(201);
    expect((await automations.POST(req("/api/automations", "POST", newCampaign))).status).toBe(201);
    for (const call of db.automation.create.mock.calls) expect(call[0].data.isActive).toBe(false);
  });

  it("POST pela tela (sessão) respeita o que a pessoa escolheu", async () => {
    await automations.POST(req("/api/automations", "POST", { ...newCampaign, isActive: true }));
    expect(db.automation.create.mock.calls[0][0].data.isActive).toBe(true);
  });

  it("import por chave cria tudo DESLIGADO", async () => {
    h.byKey = true;
    const res = await importRoute.POST(
      req("/api/automations/import", "POST", {
        instagramAccountId: "acc",
        campaigns: [
          { postId: "p1", keywords: ["A"], dmMessage: "oi" },
          { postId: "p2", keywords: ["B"], dmMessage: "oi", isActive: true },
        ],
      })
    );
    expect(res.status).toBe(200);
    expect(db.automation.create).toHaveBeenCalledTimes(2);
    for (const call of db.automation.create.mock.calls) expect(call[0].data.isActive).toBe(false);
  });

  it("PATCH isActive:true por chave = 403 human_only; desligar pode", async () => {
    h.byKey = true;
    db.automation.findFirst.mockResolvedValue(campaign({ isActive: false }));
    const on = await automations.PATCH(req("/api/automations?id=auto_1", "PATCH", { isActive: true }));
    expect(on.status).toBe(403);
    expect((await on.json()).code).toBe("human_only");
    expect(db.automation.update).not.toHaveBeenCalled();

    db.automation.findFirst.mockResolvedValue(campaign({ isActive: true }));
    const off = await automations.PATCH(req("/api/automations?id=auto_1", "PATCH", { isActive: false }));
    expect(off.status).toBe(200);
    expect(db.automation.update.mock.calls[0][0].data).toEqual({ isActive: false });
  });

  it("a pessoa logada liga normalmente", async () => {
    db.automation.findFirst.mockResolvedValue(campaign({ isActive: false }));
    const res = await automations.PATCH(req("/api/automations?id=auto_1", "PATCH", { isActive: true }));
    expect(res.status).toBe(200);
  });

  it("chave não publica o relatório da campanha", async () => {
    h.byKey = true;
    db.automation.findFirst.mockResolvedValue(campaign());
    const res = await automations.PATCH(req("/api/automations?id=auto_1", "PATCH", { reportShareEnabled: true }));
    expect(res.status).toBe(403);
    expect(db.automation.update).not.toHaveBeenCalled();
  });

  it("ativar_automacao do MCP não chama a API e avisa que é com o dono", async () => {
    const call = vi.fn() as unknown as InternalCall;
    const result = await TOOLS.find((t) => t.name === "ativar_automacao")!.run({ id: "auto_1" }, call);
    expect(call).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("dono");
  });
});

describe("campanha LIGADA: chave só mexe em nome, objetivo e desligar", () => {
  beforeEach(() => {
    h.byKey = true;
    db.automation.findFirst.mockResolvedValue(campaign({ isActive: true }));
  });

  it.each([
    [{ dmMessage: "Clica aqui no outro link" }],
    [{ openingDmMessage: "Abre aqui" }],
    [{ followUpMessage: "E aí?" }],
    [{ publicReplyMessages: ["respondi no direct"] }],
    [{ trackedDestinationUrl: "https://outro-site.example" }],
    [{ secondaryDestinationUrl: "https://outro-site.example" }],
    [{ keywords: ["QUALQUER"] }],
    [{ trigger: "STORY_MENTION" }],
  ])("%o = 409 e nada muda", async (body) => {
    const res = await automations.PATCH(req("/api/automations?id=auto_1", "PATCH", body));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("campaign_on");
    expect(db.automation.update).not.toHaveBeenCalled();
    expect(db.trackedLink.update).not.toHaveBeenCalled();
    expect(db.trackedLink.create).not.toHaveBeenCalled();
  });

  it("renomear ou mudar o objetivo passa", async () => {
    const res = await automations.PATCH(req("/api/automations?id=auto_1", "PATCH", { name: "Editor v2", goal: "Vender" }));
    expect(res.status).toBe(200);
  });

  it("mandar o mesmo texto que já está lá não conta como mudança", async () => {
    const res = await automations.PATCH(req("/api/automations?id=auto_1", "PATCH", { dmMessage: "Oi, segue o link" }));
    expect(res.status).toBe(200);
  });

  it("a pessoa logada edita o texto da campanha ligada", async () => {
    h.byKey = false;
    const res = await automations.PATCH(req("/api/automations?id=auto_1", "PATCH", { dmMessage: "Texto novo" }));
    expect(res.status).toBe(200);
  });

  it("desligada, a chave edita texto e link (fica desligada)", async () => {
    db.automation.findFirst.mockResolvedValue(campaign({ isActive: false }));
    const res = await automations.PATCH(req("/api/automations?id=auto_1", "PATCH", { dmMessage: "Novo", trackedDestinationUrl: "https://ok.example" }));
    expect(res.status).toBe(200);
  });
});

describe("apagar é coisa de gente", () => {
  it("DELETE de campanha por chave = 403; pela sessão apaga", async () => {
    db.automation.findFirst.mockResolvedValue(campaign());
    h.byKey = true;
    expect((await automations.DELETE(req("/api/automations?id=auto_1", "DELETE"))).status).toBe(403);
    expect(db.automation.delete).not.toHaveBeenCalled();
    h.byKey = false;
    expect((await automations.DELETE(req("/api/automations?id=auto_1", "DELETE"))).status).toBe(200);
  });

  it("DELETE de segmento, disparo e link por chave = 403", async () => {
    h.byKey = true;
    expect((await segment.DELETE(req("/api/segments/s1", "DELETE"), params("s1"))).status).toBe(403);
    expect((await broadcast.DELETE(req("/api/broadcasts/b1", "DELETE"), params("b1"))).status).toBe(403);
    expect((await link.DELETE(req("/api/conversation-links/l1", "DELETE"), params("l1"))).status).toBe(403);
    expect(db.segment.delete).not.toHaveBeenCalled();
    expect(db.broadcast.delete).not.toHaveBeenCalled();
    expect(db.conversationLink.deleteMany).not.toHaveBeenCalled();
  });
});

describe("membros: chave não vira admin humano", () => {
  it("POST, PATCH e DELETE por chave = 403 e nada é gravado", async () => {
    h.byKey = true;
    expect((await members.POST(req("/api/workspace/members", "POST", { email: "x@ex.com", role: "ADMIN" }))).status).toBe(403);
    expect((await members.PATCH(req("/api/workspace/members", "PATCH", { memberId: "m1", role: "ADMIN" }))).status).toBe(403);
    expect((await members.DELETE(req("/api/workspace/members", "DELETE", { memberId: "m1" }))).status).toBe(403);
    expect(db.workspaceMember.upsert).not.toHaveBeenCalled();
    expect(db.workspaceInvitation.upsert).not.toHaveBeenCalled();
    expect(db.workspaceMember.update).not.toHaveBeenCalled();
    expect(db.workspaceMember.delete).not.toHaveBeenCalled();
  });

  it("GET por chave não devolve o token nem o link do convite; pela sessão devolve", async () => {
    db.workspaceInvitation.findMany.mockResolvedValue([
      { id: "i1", email: "a@ex.com", role: "ADMIN", token: "segredo-do-convite", expiresAt: new Date(), createdAt: new Date() },
    ]);
    h.byKey = true;
    const viaKey = await (await members.GET()).json();
    expect(JSON.stringify(viaKey)).not.toContain("segredo-do-convite");
    expect(viaKey.data.invitations[0].inviteUrl).toBeUndefined();
    h.byKey = false;
    const viaSession = await (await members.GET()).json();
    expect(viaSession.data.invitations[0].token).toBe("segredo-do-convite");
    expect(viaSession.data.invitations[0].inviteUrl).toContain("segredo-do-convite");
  });

  it("admin não rebaixa o dono reconvidando o e-mail dele", async () => {
    h.role = "ADMIN";
    db.user.findUnique.mockResolvedValue({ id: "u_dono" });
    db.workspaceMember.findUnique.mockResolvedValue({ role: "OWNER" });
    const res = await members.POST(req("/api/workspace/members", "POST", { email: "dono@ex.com", role: "MEMBER" }));
    expect(res.status).toBe(400);
    expect(db.workspaceMember.upsert).not.toHaveBeenCalled();
  });

  it("ninguém troca o próprio cargo pelo convite", async () => {
    db.user.findUnique.mockResolvedValue({ id: "u_owner" });
    db.workspaceMember.findUnique.mockResolvedValue({ role: "OWNER" });
    const res = await members.POST(req("/api/workspace/members", "POST", { email: "eu@ex.com", role: "MEMBER" }));
    expect(res.status).toBe(400);
  });

  it("convidar alguém que já tem conta e não é dono continua funcionando", async () => {
    db.user.findUnique.mockResolvedValue({ id: "u_outro" });
    db.workspaceMember.findUnique.mockResolvedValue(null);
    const res = await members.POST(req("/api/workspace/members", "POST", { email: "outro@ex.com", role: "MEMBER" }));
    expect(res.status).toBe(200);
    expect(db.workspaceMember.upsert).toHaveBeenCalledTimes(1);
  });
});

describe("links de conversa", () => {
  it("chave não pendura uma campanha LIGADA num link novo", async () => {
    h.byKey = true;
    db.automation.findFirst.mockResolvedValue({ id: "auto_1", isActive: true });
    const res = await links.POST(req("/api/conversation-links", "POST", { origin: "story", automationId: "auto_1" }));
    expect(res.status).toBe(409);
    expect(db.conversationLink.create).not.toHaveBeenCalled();
  });

  it("chave não liga um link desligado nem troca pra uma campanha ligada", async () => {
    h.byKey = true;
    db.conversationLink.findFirst.mockResolvedValue({ id: "l1", instagramAccountId: "acc", isActive: false });
    expect((await link.PATCH(req("/api/conversation-links/l1", "PATCH", { isActive: true }), params("l1"))).status).toBe(403);
    db.automation.findFirst.mockResolvedValue({ id: "auto_1", isActive: true });
    expect((await link.PATCH(req("/api/conversation-links/l1", "PATCH", { automationId: "auto_1" }), params("l1"))).status).toBe(409);
    expect(db.conversationLink.update).not.toHaveBeenCalled();
  });

  it("chave pode desligar o link", async () => {
    h.byKey = true;
    db.conversationLink.findFirst.mockResolvedValue({ id: "l1", instagramAccountId: "acc", isActive: true });
    db.conversationLink.update.mockResolvedValue({ id: "l1" });
    // presentLinks (the answer's formatting) is not mocked here; only the write matters.
    await link.PATCH(req("/api/conversation-links/l1", "PATCH", { isActive: false }), params("l1")).catch(() => null);
    expect(db.conversationLink.update).toHaveBeenCalledTimes(1);
    expect(db.conversationLink.update.mock.calls[0][0].data).toEqual({ isActive: false });
  });
});
