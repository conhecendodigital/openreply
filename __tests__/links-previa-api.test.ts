/**
 * Prévia do link na API de campanhas (07/10/2026): título, descrição e
 * imagem da prévia do link principal (linkPreview*), guardados no
 * TrackedLink e nunca no Automation.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  prisma: {
    workspace: { findUnique: vi.fn(async () => ({ id: "ws", linkDomain: null })) },
    instagramAccount: { findFirst: vi.fn(async () => ({ id: "acc_row" })) },
    automation: {
      create: vi.fn(async (a: { data: Record<string, unknown> }) => ({ id: "auto_new", ...a.data })),
      findFirst: vi.fn(async () => ({ id: "auto_1", workspaceId: "ws", isActive: false, trigger: "COMMENT" })),
      update: vi.fn(async (a: { data: Record<string, unknown> }) => ({ id: "auto_1", ...a.data })),
    },
    trackedLink: {
      findFirst: vi.fn(async () => ({ id: "tl_1" })),
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({})),
    },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/auth", () => ({
  getCurrentWorkspaceId: vi.fn(async () => "ws"),
  isApiTokenRequest: vi.fn(async () => false),
}));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => ({ workspaceId: "ws", userId: "u1", role: "OWNER" })),
  canManageWorkspace: () => true,
}));

import { PATCH, POST } from "../app/api/automations/route";

const req = (method: string, body: unknown, query = "") =>
  new NextRequest(new URL(`/api/automations${query}`, "http://localhost"), {
    method,
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => vi.clearAllMocks());

describe("prévia do link na campanha", () => {
  it("POST grava a prévia no link principal", async () => {
    const res = await POST(
      req("POST", {
        name: "Chat",
        matchAnyPost: true,
        keywords: ["CHAT"],
        dmMessage: "Pega aqui {link}",
        trackedDestinationUrl: "https://quiz.cloudmatheus.com.br/diag",
        linkPreviewTitle: " Seu diagnóstico ",
        linkPreviewDescription: "",
        linkPreviewImageUrl: "https://midia.zapcriativo.com/quiz/og.png",
      })
    );
    expect(res.status).toBe(201);
    const data = h.prisma.automation.create.mock.calls[0][0].data as { trackedLinks: { create: Record<string, unknown>[] } };
    expect(data).not.toHaveProperty("linkPreviewTitle");
    expect(data.trackedLinks.create[0]).toMatchObject({
      destinationUrl: "https://quiz.cloudmatheus.com.br/diag",
      previewTitle: "Seu diagnóstico",
      previewDescription: null,
      previewImageUrl: "https://midia.zapcriativo.com/quiz/og.png",
    });
  });

  it("PATCH só com a prévia muda o link principal e nada do Automation", async () => {
    const res = await PATCH(req("PATCH", { linkPreviewTitle: "Novo título", linkPreviewImageUrl: null }, "?id=auto_1"));
    expect(res.status).toBe(200);
    expect(h.prisma.automation.update.mock.calls[0][0].data).toEqual({});
    expect(h.prisma.trackedLink.update).toHaveBeenCalledWith({ where: { id: "tl_1" }, data: { previewTitle: "Novo título", previewImageUrl: null } });
  });

  it("imagem precisa ser https", async () => {
    const res = await PATCH(req("PATCH", { linkPreviewImageUrl: "http://site.com/a.png" }, "?id=auto_1"));
    expect(res.status).toBe(400);
    expect(h.prisma.trackedLink.update).not.toHaveBeenCalled();
  });
});
