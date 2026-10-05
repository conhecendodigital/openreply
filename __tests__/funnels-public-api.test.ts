/**
 * Etapa 6: APIs públicas do quiz (/api/q/<slug>/event e /lead). Só funil
 * PUBLICADO, corpo pequeno, limite por IP, nada de confiar no navegador
 * (opção que não existe é ignorada), honeypot, consentimento obrigatório,
 * token c assinado liga o contato e as etiquetas por resposta caem no CRM.
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
  const prisma = new Proxy({} as Record<string, unknown>, { get: (_t, name: string) => model(name) });
  return {
    prisma: prisma as unknown as Record<string, Record<string, ReturnType<typeof vi.fn>>>,
    models,
    rate: vi.fn(async () => ({ allowed: true, count: 1, limit: 1 })),
    addTag: vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true),
    recordEvent: vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true),
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/workspace-access", () => ({ getCurrentWorkspaceContext: vi.fn(async () => null), canManageWorkspace: () => false }));
vi.mock("@/lib/auth", () => ({ getApiCaller: vi.fn(async () => ({ kind: "none" })) }));
vi.mock("@/lib/http-rate-limit", () => ({ hitRateLimit: h.rate }));
vi.mock("@/lib/contacts/record", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/contacts/record")>();
  return { ...real, addTag: h.addTag, recordEvent: h.recordEvent };
});

import * as eventRoute from "../app/api/q/[slug]/event/route";
import * as leadRoute from "../app/api/q/[slug]/lead/route";
import { funnelContactToken, withFunnelContact } from "../lib/funnels/contact-link";
import { getDraftPreview, getPublishedFunnelBySlug } from "../lib/funnels/public";
import type { FunnelDefinition } from "../lib/funnels/types";

const VISITOR = "0123456789abcdef0123456789abcdef";
const def: FunnelDefinition = {
  schemaVersion: 1,
  settings: { theme: { mode: "light", primary: "#0095f6", background: "#ffffff", text: "#000000" }, checkoutUrl: "https://pay.hotmart.com/X" },
  steps: [
    {
      id: "s1",
      title: "P1",
      blocks: [
        {
          id: "b1",
          type: "options",
          name: "nivel",
          multiple: false,
          options: [
            { id: "o1", label: "Zero", tag: "quiz:nivel-zero" },
            { id: "o2", label: "Avançado", tag: "quiz:nivel-avancado" },
          ],
        },
      ],
    },
    {
      id: "s2",
      title: "Dados",
      blocks: [
        { id: "f1", type: "field", field: "name", label: "Nome" },
        { id: "f2", type: "field", field: "email", label: "E-mail" },
        { id: "f3", type: "field", field: "whatsapp", label: "WhatsApp", required: false },
        { id: "b2", type: "button", label: "Enviar", action: { kind: "next" } },
      ],
    },
    { id: "s3", title: "Oferta", blocks: [{ id: "b3", type: "button", label: "Comprar", action: { kind: "checkout" } }] },
  ],
};

function funnelRow(over: Record<string, unknown> = {}) {
  return {
    id: "f_1",
    workspaceId: "ws_A",
    name: "Chat",
    slug: "chat",
    status: "PUBLISHED",
    draft: def,
    published: def,
    publishedVersion: 2,
    ...over,
  };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, "http://localhost"), {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4", "user-agent": "Mozilla/5.0 (iPhone) Mobile", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}
const slugParams = (slug = "chat") => ({ params: Promise.resolve({ slug }) });
const event = (body: Record<string, unknown>) =>
  eventRoute.POST(post("/api/q/chat/event", { visitorId: VISITOR, version: 2, ...body }), slugParams());
const lead = (body: Record<string, unknown>) =>
  leadRoute.POST(post("/api/q/chat/lead", { visitorId: VISITOR, version: 2, stepId: "s2", consent: true, ...body }), slugParams());

function resetModels() {
  for (const m of h.models.values()) for (const key of Object.keys(m)) delete m[key];
}

beforeEach(() => {
  vi.clearAllMocks();
  resetModels();
  h.rate.mockResolvedValue({ allowed: true, count: 1, limit: 1 });
  h.prisma.funnel.findUnique.mockResolvedValue(funnelRow());
  h.prisma.funnelVisit.upsert.mockResolvedValue({ id: "v_1", contactId: null });
  h.prisma.funnelEvent.createMany.mockResolvedValue({ count: 1 });
  h.prisma.funnelEvent.findMany.mockResolvedValue([]);
  h.prisma.funnelLead.upsert.mockResolvedValue({ id: "l_1" });
});

describe("só funil publicado", () => {
  it.each([
    ["rascunho", { status: "DRAFT" }],
    ["arquivado", { status: "ARCHIVED" }],
    ["publicado sem cópia", { published: null }],
  ])("%s = 404 sem detalhe", async (_n, over) => {
    h.prisma.funnel.findUnique.mockResolvedValue(funnelRow(over));
    const res = await event({ type: "view", stepId: "s1" });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: "Not found" });
    expect(h.prisma.funnelVisit.upsert).not.toHaveBeenCalled();
  });

  it("slug inexistente = 404", async () => {
    h.prisma.funnel.findUnique.mockResolvedValue(null);
    expect((await event({ type: "view", stepId: "s1" })).status).toBe(404);
  });

  it("página pública só lê o publicado; prévia só do workspace", async () => {
    expect((await getPublishedFunnelBySlug("chat"))?.version).toBe(2);
    h.prisma.funnel.findUnique.mockResolvedValue(funnelRow({ status: "DRAFT" }));
    expect(await getPublishedFunnelBySlug("chat")).toBeNull();
    h.prisma.funnel.findFirst.mockResolvedValue(funnelRow({ status: "DRAFT" }));
    const preview = await getDraftPreview("chat", "ws_A");
    expect(preview?.version).toBe(0);
    expect(h.prisma.funnel.findFirst.mock.calls[0][0].where).toEqual({ slug: "chat", workspaceId: "ws_A" });
    h.prisma.funnel.findFirst.mockResolvedValue(null);
    expect(await getDraftPreview("chat", "ws_B")).toBeNull();
  });
});

describe("eventos", () => {
  it("view grava 1 visita (upsert) e o evento sem duplicar", async () => {
    const res = await event({ type: "view", stepId: "s1", tracking: { utm_source: "Instagram", c: "x", foo: "bar" }, referrer: "https://l.instagram.com/x" });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ ok: true });
    const upsert = h.prisma.funnelVisit.upsert.mock.calls[0][0];
    expect(upsert.where).toEqual({ funnelId_visitorId: { funnelId: "f_1", visitorId: VISITOR } });
    expect(upsert.create).toMatchObject({
      workspaceId: "ws_A",
      funnelVersion: 2,
      source: "instagram",
      referrerHost: "l.instagram.com",
      device: "mobile",
      tracking: { utm_source: "Instagram" },
    });
    expect(upsert.create.ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(h.prisma.funnelEvent.createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true, data: [{ type: "view", stepId: "s1", blockId: "" }] });
  });

  it("última tela marca completedAt; tela >= 1 marca startedAt", async () => {
    await event({ type: "view", stepId: "s3" });
    const fields = h.prisma.funnelVisit.updateMany.mock.calls.map((c) => Object.keys(c[0].data)[0]);
    expect(fields).toEqual(expect.arrayContaining(["maxStepIndex", "startedAt", "completedAt"]));
  });

  it("answer com opção que não existe é ignorada", async () => {
    const res = await event({ type: "answer", stepId: "s1", blockId: "b1", optionIds: ["nao-existe"] });
    expect((await res.json()).data).toEqual({ ok: true, ignored: true });
    expect(h.prisma.funnelEvent.upsert).not.toHaveBeenCalled();
  });

  it("answer com tag e visita com contato chama addTag (escolha única fica com 1)", async () => {
    h.prisma.funnelVisit.upsert.mockResolvedValue({ id: "v_1", contactId: "c_1" });
    await event({ type: "answer", stepId: "s1", blockId: "b1", optionIds: ["o1", "o2"] });
    const up = h.prisma.funnelEvent.upsert.mock.calls[0][0];
    expect(up.create.value).toEqual({ optionIds: ["o1"] });
    const tags = h.addTag.mock.calls.map((c) => c[1]);
    expect(tags).toEqual(expect.arrayContaining(["quiz:chat", "quiz:nivel-zero"]));
    expect(tags).not.toContain("quiz:nivel-avancado");
    expect(h.addTag.mock.calls[0][0]).toEqual({ id: "c_1", workspaceId: "ws_A" });
  });

  it("versão antiga, tela ou bloco que não existe = ignored", async () => {
    expect((await (await event({ type: "view", stepId: "s1", version: 1 })).json()).data).toEqual({ ok: true, ignored: true });
    expect((await (await event({ type: "view", stepId: "sumiu" })).json()).data.ignored).toBe(true);
    expect((await (await event({ type: "checkout", stepId: "s3", blockId: "sumiu" })).json()).data.ignored).toBe(true);
    expect(h.prisma.funnelVisit.upsert).not.toHaveBeenCalled();
  });

  it("checkout marca checkoutAt e registra no contato", async () => {
    h.prisma.funnelVisit.upsert.mockResolvedValue({ id: "v_1", contactId: "c_1" });
    await event({ type: "checkout", stepId: "s3", blockId: "b3" });
    expect(h.prisma.funnelVisit.updateMany.mock.calls.some((c) => "checkoutAt" in c[0].data)).toBe(true);
    expect(h.recordEvent.mock.calls[0][1]).toMatchObject({ type: "FUNNEL_CHECKOUT", refId: "v_1" });
  });

  it("corpo > 8 KB = 413; rate limit = 429; JSON ruim = 400", async () => {
    const big = await eventRoute.POST(post("/api/q/chat/event", JSON.stringify({ visitorId: VISITOR, pad: "x".repeat(9000) })), slugParams());
    expect(big.status).toBe(413);
    expect((await big.json()).details.code).toBe("too_large");
    h.rate.mockResolvedValueOnce({ allowed: false, count: 999, limit: 120 });
    const limited = await event({ type: "view", stepId: "s1" });
    expect(limited.status).toBe(429);
    expect((await limited.json()).details.code).toBe("rate_limited");
    expect((await eventRoute.POST(post("/api/q/chat/event", "{nada"), slugParams())).status).toBe(400);
    expect((await event({ type: "view", stepId: "s1", visitorId: "curto" })).status).toBe(400);
  });

  it("token c válido liga o contato; adulterado não", async () => {
    h.prisma.contact.findFirst.mockResolvedValue({ id: "c_9", workspaceId: "ws_A" });
    await event({ type: "view", stepId: "s1", contactToken: funnelContactToken("chat", "1789") });
    expect(h.prisma.contact.findFirst.mock.calls[0][0].where).toEqual({ workspaceId: "ws_A", igUserId: "1789" });
    expect(h.prisma.funnelVisit.upsert.mock.calls[0][0].create.contactId).toBe("c_9");

    vi.clearAllMocks();
    h.prisma.funnelVisit.upsert.mockResolvedValue({ id: "v_1", contactId: null });
    const forged = funnelContactToken("chat", "1789").replace(/^1789/, "9999");
    await event({ type: "view", stepId: "s1", contactToken: forged });
    expect(h.prisma.contact.findFirst).not.toHaveBeenCalled();
    expect(h.prisma.funnelVisit.upsert.mock.calls[0][0].create.contactId).toBeNull();
    // Token de outro funil não vale aqui.
    vi.clearAllMocks();
    h.prisma.funnelVisit.upsert.mockResolvedValue({ id: "v_1", contactId: null });
    await event({ type: "view", stepId: "s1", contactToken: funnelContactToken("outro", "1789") });
    expect(h.prisma.contact.findFirst).not.toHaveBeenCalled();
  });

  it("link rastreado pro quiz do próprio site ganha c; outro site não", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://many.leadenginer.com");
    const out = withFunnelContact("https://many.leadenginer.com/q/chat?utm_source=dm", "1789");
    expect(new URL(out).searchParams.get("c")).toBe(funnelContactToken("chat", "1789"));
    expect(new URL(out).searchParams.get("utm_source")).toBe("dm");
    expect(withFunnelContact("https://outro.com/q/chat", "1789")).toBe("https://outro.com/q/chat");
    expect(withFunnelContact("https://many.leadenginer.com/q/chat", null)).toBe("https://many.leadenginer.com/q/chat");
    vi.unstubAllEnvs();
  });
});

describe("lead", () => {
  it("honeypot preenchido = 200 e nada gravado", async () => {
    const res = await lead({ fields: { name: "Bot", email: "bot@x.com" }, website: "http://spam" });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ ok: true });
    expect(h.prisma.funnel.findUnique).not.toHaveBeenCalled();
    expect(h.prisma.funnelLead.upsert).not.toHaveBeenCalled();
  });

  it("sem consentimento = 400 consent_required", async () => {
    const res = await lead({ fields: { name: "Ana", email: "ana@x.com" }, consent: false });
    expect(res.status).toBe(400);
    expect((await res.json()).details.code).toBe("consent_required");
    expect(h.prisma.funnelLead.upsert).not.toHaveBeenCalled();
  });

  it("e-mail e WhatsApp normalizados, respostas viram rótulos e etiquetas", async () => {
    h.prisma.funnelEvent.findMany.mockResolvedValue([{ blockId: "b1", value: { optionIds: ["o2"] } }]);
    h.prisma.funnelVisit.upsert.mockResolvedValue({ id: "v_1", contactId: "c_1" });
    const res = await lead({ fields: { name: "  Ana   Souza ", email: " ANA@Ex.COM ", whatsapp: "(11) 99999-8888" } });
    expect(res.status).toBe(200);
    const up = h.prisma.funnelLead.upsert.mock.calls[0][0];
    expect(up.where).toEqual({ visitId: "v_1" });
    expect(up.create).toMatchObject({
      name: "Ana Souza",
      email: "ana@ex.com",
      phone: "5511999998888",
      answers: { nivel: "Avançado" },
      tags: ["quiz:nivel-avancado"],
      contactId: "c_1",
      funnelId: "f_1",
    });
    expect(up.create.consentAt).toBeInstanceOf(Date);
    expect(h.recordEvent.mock.calls[0][1]).toMatchObject({ type: "FUNNEL_LEAD", refId: "l_1" });
  });

  it("campo obrigatório faltando ou inválido = 400 invalid_lead", async () => {
    const a = await lead({ fields: { name: "Ana" } });
    expect(a.status).toBe(400);
    expect((await a.json()).details).toMatchObject({ code: "invalid_lead", fields: ["email"] });
    const b = await lead({ fields: { name: "Ana", email: "ana@x.com", whatsapp: "123" } });
    expect((await b.json()).details.fields).toEqual(["whatsapp"]);
  });

  it("tela sem campo de dados = ignored", async () => {
    const res = await lead({ stepId: "s1", fields: { email: "ana@x.com" } });
    expect((await res.json()).data).toEqual({ ok: true, ignored: true });
  });
});
