/**
 * Remover membro do workspace: DELETE /api/workspace/members com memberId.
 * Dono remove Admin e Membro; Admin só remove Membro; ninguém remove o dono
 * nem a si mesmo; chave de API não gerencia membros. Só a membership sai.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type Role = "OWNER" | "ADMIN" | "MEMBER";
const h = vi.hoisted(() => ({
  apiToken: false as boolean,
  ctx: { workspaceId: "ws", userId: "u_me", role: "OWNER" } as { workspaceId: string; userId: string; role: string },
  target: null as null | { id: string; userId: string; role: string },
  prisma: {
    workspaceMember: {
      findFirst: vi.fn(),
      findMany: vi.fn(async () => []),
      delete: vi.fn(async () => ({})),
    },
    workspaceInvitation: { findMany: vi.fn(async () => []), updateMany: vi.fn() },
    operationalEvent: { create: vi.fn(async () => ({})) },
    user: { delete: vi.fn() },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/auth", () => ({ isApiTokenRequest: vi.fn(async () => h.apiToken) }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => h.ctx),
  canManageWorkspace: (r: string) => r === "OWNER" || r === "ADMIN",
}));

import { DELETE } from "../app/api/workspace/members/route";
import { canRemoveMember } from "../lib/workspace-member-rules";

function del(body: unknown) {
  return DELETE(
    new NextRequest(new URL("/api/workspace/members", "http://localhost"), {
      method: "DELETE",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    })
  );
}

function setup(actor: Role, target: { userId: string; role: Role } | null) {
  h.ctx = { workspaceId: "ws", userId: "u_me", role: actor };
  h.prisma.workspaceMember.findFirst.mockResolvedValue(target ? { id: "m1", ...target } : null);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.apiToken = false;
});

describe("DELETE /api/workspace/members (memberId)", () => {
  it("OWNER removes a MEMBER, only the membership, with an audit event", async () => {
    setup("OWNER", { userId: "u_rob", role: "MEMBER" });
    const res = await del({ memberId: "m1" });
    expect(res.status).toBe(200);
    expect(h.prisma.workspaceMember.delete).toHaveBeenCalledWith({ where: { id: "m1" } });
    expect(h.prisma.user.delete).not.toHaveBeenCalled();
    const ev = (h.prisma.operationalEvent.create.mock.calls as unknown as Array<[{ data: { payload: unknown } }]>)[0][0].data;
        expect(ev.payload).toMatchObject({ removedUserId: "u_rob", removedByUserId: "u_me" });
  });

  it("OWNER removes an ADMIN", async () => {
    setup("OWNER", { userId: "u_adm", role: "ADMIN" });
    expect((await del({ memberId: "m1" })).status).toBe(200);
    expect(h.prisma.workspaceMember.delete).toHaveBeenCalled();
  });

  it("ADMIN removes a MEMBER", async () => {
    setup("ADMIN", { userId: "u_rob", role: "MEMBER" });
    expect((await del({ memberId: "m1" })).status).toBe(200);
  });

  it("ADMIN cannot remove another ADMIN or the OWNER", async () => {
    for (const role of ["ADMIN", "OWNER"] as Role[]) {
      setup("ADMIN", { userId: "u_x", role });
      expect((await del({ memberId: "m1" })).status).toBe(400);
    }
    expect(h.prisma.workspaceMember.delete).not.toHaveBeenCalled();
    expect(h.prisma.operationalEvent.create).not.toHaveBeenCalled();
  });

  it("nobody removes themselves or the owner", async () => {
    setup("OWNER", { userId: "u_me", role: "MEMBER" });
    expect((await del({ memberId: "m1" })).status).toBe(400);
    setup("ADMIN", { userId: "u_me", role: "ADMIN" });
    expect((await del({ memberId: "m1" })).status).toBe(400);
    setup("OWNER", { userId: "u_other", role: "OWNER" });
    expect((await del({ memberId: "m1" })).status).toBe(400);
    expect(h.prisma.workspaceMember.delete).not.toHaveBeenCalled();
  });

  it("MEMBER cannot remove anyone", async () => {
    setup("MEMBER", { userId: "u_rob", role: "MEMBER" });
    expect((await del({ memberId: "m1" })).status).toBe(403);
    expect(h.prisma.workspaceMember.delete).not.toHaveBeenCalled();
  });

  it("member of another workspace (not found) is refused", async () => {
    setup("OWNER", null);
    expect((await del({ memberId: "nope" })).status).toBe(400);
    expect((h.prisma.workspaceMember.findFirst.mock.calls as unknown as Array<[{ where: unknown }]>)[0][0].where).toMatchObject({ workspaceId: "ws" });
  });

  it("API key is blocked", async () => {
    h.apiToken = true;
    setup("OWNER", { userId: "u_rob", role: "MEMBER" });
    const res = await del({ memberId: "m1" });
    expect(res.status).toBe(403);
    expect(h.prisma.workspaceMember.delete).not.toHaveBeenCalled();
  });

  it("an audit failure does not undo the removal", async () => {
    setup("OWNER", { userId: "u_rob", role: "MEMBER" });
    h.prisma.operationalEvent.create.mockRejectedValueOnce(new Error("db"));
    expect((await del({ memberId: "m1" })).status).toBe(200);
  });
});

describe("canRemoveMember (regra usada pela tela)", () => {
  const me = (role: Role) => ({ role, userId: "me" });
  it("matrix", () => {
    expect(canRemoveMember(me("OWNER"), { role: "MEMBER", userId: "x" })).toBe(true);
    expect(canRemoveMember(me("OWNER"), { role: "ADMIN", userId: "x" })).toBe(true);
    expect(canRemoveMember(me("OWNER"), { role: "OWNER", userId: "x" })).toBe(false);
    expect(canRemoveMember(me("OWNER"), { role: "MEMBER", userId: "me" })).toBe(false);
    expect(canRemoveMember(me("ADMIN"), { role: "MEMBER", userId: "x" })).toBe(true);
    expect(canRemoveMember(me("ADMIN"), { role: "ADMIN", userId: "x" })).toBe(false);
    expect(canRemoveMember(me("ADMIN"), { role: "OWNER", userId: "x" })).toBe(false);
    expect(canRemoveMember(me("MEMBER"), { role: "MEMBER", userId: "x" })).toBe(false);
  });
});
