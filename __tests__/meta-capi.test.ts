/**
 * Pixel padrão da conta + API de Conversões da Meta (CAPI), com fetch mockado:
 * - hash SHA-256 de e-mail/telefone normalizados, fbc a partir do fbclid;
 * - event_id igual ao do Pixel do navegador (dedupe);
 * - sem token / sem consentimento (modo banner sem "Aceitar") = nada sai;
 * - Purchase da Hotmart com value/currency e o ip/ua/fbc/fbp da visita;
 * - o token nunca volta em resposta de API (nem criptografado);
 * - chave de API recebe 403 nas rotas novas (proxy.ts e a própria rota).
 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    byKey: false,
    role: "OWNER" as "OWNER" | "ADMIN" | "MEMBER",
    rate: vi.fn(async () => ({ allowed: true, count: 1, limit: 1 })),
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/auth", () => ({
  isApiTokenRequest: vi.fn(async () => h.byKey),
  getApiCaller: vi.fn(async () => (h.byKey ? { kind: "token", tokenId: "tok", scopes: [] } : { kind: "session" })),
}));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: vi.fn(async () => ({ workspaceId: "ws_A", userId: "u_1", role: h.role })),
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));
vi.mock("@/lib/http-rate-limit", () => ({ hitRateLimit: h.rate }));
vi.mock("@/lib/contacts/record", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/contacts/record")>();
  return { ...real, addTag: vi.fn(async () => true), recordEvent: vi.fn(async () => true) };
});

import * as eventRoute from "../app/api/q/[slug]/event/route";
import * as leadRoute from "../app/api/q/[slug]/lead/route";
import * as capiRoute from "../app/api/workspace/meta-capi/route";
import * as capiTestRoute from "../app/api/workspace/meta-capi/test/route";
import { proxy } from "../proxy";
import { isApiKeyRouteAllowed } from "../lib/api-key-routes";
import {
  buildUserData,
  fbcFromFbclid,
  normalizeCapiEmail,
  normalizeCapiPhone,
  sendCapiEvent,
  sha256,
} from "../lib/meta/capi";
import { decryptToken, encryptToken } from "../lib/meta/oauth";
import { getPublishedFunnelBySlug } from "../lib/funnels/public";
import { applyHotmartPurchase, parseHotmartPayload } from "../lib/funnels/hotmart";
import type { FunnelDefinition } from "../lib/funnels/types";

const KEY = "a".repeat(64);
const TOKEN = "EAABsbCS1iHgBOZCtestTOKENvalue1234abcd";
const PIXEL = "123456789012345";
const VISITOR = "0123456789abcdef0123456789abcdef";
const CREATED = new Date(Date.now() - 60_000);

const def = (settings: Partial<FunnelDefinition["settings"]> = {}): FunnelDefinition => ({
  schemaVersion: 1,
  settings: {
    theme: { mode: "light", primary: "#0095f6", background: "#ffffff", text: "#000000" },
    checkoutUrl: "https://pay.hotmart.com/X",
    ...settings,
  },
  steps: [
    {
      id: "s1",
      title: "Dados",
      blocks: [
        { id: "f1", type: "field", field: "name", label: "Nome" },
        { id: "f2", type: "field", field: "email", label: "E-mail" },
        { id: "f3", type: "field", field: "whatsapp", label: "WhatsApp", required: false },
        { id: "b2", type: "button", label: "Enviar", action: { kind: "next" } },
      ],
    },
    { id: "s2", title: "Oferta", blocks: [{ id: "b3", type: "button", label: "Comprar", action: { kind: "checkout" } }] },
  ],
});

let capiRow: { pixelId: string | null; accessTokenEnc: string | null; testEventCode: string | null } | null = null;

function funnelRow(settings: Partial<FunnelDefinition["settings"]> = {}) {
  const d = def(settings);
  return {
    id: "f_1",
    workspaceId: "ws_A",
    name: "Chat",
    slug: "chat",
    status: "PUBLISHED",
    draft: d,
    published: d,
    publishedVersion: 2,
    workspace: { metaCapi: capiRow },
  };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, "http://localhost"), {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4", "user-agent": "Mozilla/5.0 (iPhone) Mobile", ...headers },
    body: JSON.stringify(body),
  });
}
const slugParams = { params: Promise.resolve({ slug: "chat" }) };
const event = (body: Record<string, unknown>) =>
  eventRoute.POST(post("/api/q/chat/event", { visitorId: VISITOR, version: 2, ...body }), slugParams);
const lead = (body: Record<string, unknown>) =>
  leadRoute.POST(
    post("/api/q/chat/lead", {
      visitorId: VISITOR,
      version: 2,
      stepId: "s1",
      consent: true,
      fields: { name: "Ana Souza", email: " ANA@Ex.COM ", whatsapp: "(11) 99999-8888" },
      ...body,
    }),
    slugParams
  );

const fetchMock = vi.fn<(...args: unknown[]) => Promise<Response>>(async () =>
  new Response(JSON.stringify({ events_received: 1, fbtrace_id: "trace" }), { status: 200 })
);
const sentBodies = () => fetchMock.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)));
const flush = () => new Promise((r) => setTimeout(r, 15));

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of h.models.values()) for (const key of Object.keys(m)) delete m[key];
  vi.stubEnv("ENCRYPTION_KEY", KEY);
  vi.stubEnv("NEXTAUTH_URL", "https://app.example.com");
  vi.stubGlobal("fetch", fetchMock);
  h.byKey = false;
  h.role = "OWNER";
  h.rate.mockResolvedValue({ allowed: true, count: 1, limit: 1 });
  capiRow = { pixelId: PIXEL, accessTokenEnc: encryptToken(TOKEN), testEventCode: null };
  h.prisma.funnel.findUnique.mockImplementation(async () => funnelRow());
  // Like Prisma: the upsert answers the row as saved.
  h.prisma.funnelVisit.upsert.mockImplementation(async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({
    id: "v_1",
    contactId: null,
    createdAt: CREATED,
    tracking: args.create.tracking ?? null,
    ...args.create,
    ...args.update,
  }));
  h.prisma.funnelEvent.createMany.mockResolvedValue({ count: 1 });
  h.prisma.funnelEvent.findMany.mockResolvedValue([]);
  h.prisma.funnelLead.upsert.mockResolvedValue({ id: "l_1" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("hash e normalização", () => {
  it("e-mail minúsculo sem espaço e telefone só dígitos com DDI, em SHA-256", async () => {
    expect(normalizeCapiEmail("  ANA@Ex.COM ")).toBe("ana@ex.com");
    expect(normalizeCapiEmail("não é e-mail")).toBeNull();
    expect(normalizeCapiPhone("(11) 99999-8888")).toBe("5511999998888");
    expect(normalizeCapiPhone("+55 11 99999-8888")).toBe("5511999998888");
    expect(normalizeCapiPhone("12")).toBeNull();
    const u = buildUserData({ email: " ANA@Ex.COM ", phone: "(11) 99999-8888", name: "Ána Souza", externalId: VISITOR });
    expect(u.em).toEqual([createHash("sha256").update("ana@ex.com").digest("hex")]);
    expect(u.ph).toEqual([sha256("5511999998888")]);
    expect(u.fn).toEqual([sha256("ana")]);
    expect(u.ln).toEqual([sha256("souza")]);
    expect(u.external_id).toEqual([sha256(VISITOR)]);
    expect(JSON.stringify(u)).not.toContain("ana@ex.com");
  });

  it("fbc a partir do fbclid: fb.1.<ms>.<fbclid>; fbp/fbc inválidos ficam de fora", async () => {
    expect(fbcFromFbclid("IwAR123abc", 1_760_000_000_123)).toBe("fb.1.1760000000123.IwAR123abc");
    expect(fbcFromFbclid("", 1)).toBeNull();
    expect(fbcFromFbclid("<script>", 1)).toBeNull();
    const u = buildUserData({ fbp: "lixo", fbc: "fb.1.1760000000123.IwAR123abc", ip: "1.2.3.4", userAgent: "UA" });
    expect(u.fbp).toBeUndefined();
    expect(u.fbc).toBe("fb.1.1760000000123.IwAR123abc");
    expect(u.client_ip_address).toBe("1.2.3.4");
    expect(u.client_user_agent).toBe("UA");
  });
});

describe("sendCapiEvent", () => {
  it("manda pro /<pixel>/events com o token só no cabeçalho e action_source website", async () => {
    const r = await sendCapiEvent(capiRow, { eventName: "Lead", eventId: "lead_abc12345", user: { email: "a@b.com" } });
    expect(r).toEqual({ ok: true, eventsReceived: 1, fbtraceId: "trace" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(new RegExp(`^https://graph\\.facebook\\.com/v\\d+\\.0/${PIXEL}/events$`));
    expect(url).not.toContain(TOKEN);
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    const body = sentBodies()[0];
    expect(body.data[0]).toMatchObject({ event_name: "Lead", event_id: "lead_abc12345", action_source: "website" });
    expect(body.test_event_code).toBeUndefined();
  });

  it("sem token ou sem pixel não chama a Meta", async () => {
    expect(await sendCapiEvent({ pixelId: PIXEL, accessTokenEnc: null, testEventCode: null }, { eventName: "Lead", eventId: "lead_abc12345", user: {} })).toEqual({
      ok: false,
      code: "not_configured",
    });
    expect(await sendCapiEvent({ pixelId: null, accessTokenEnc: capiRow!.accessTokenEnc, testEventCode: null }, { eventName: "Lead", eventId: "lead_abc12345", user: {} })).toMatchObject({
      ok: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("erro da Meta vira código, não lança, e o token nunca aparece na mensagem", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 190, message: `Invalid OAuth access token ${TOKEN}` } }), { status: 400 })
    );
    const r = await sendCapiEvent(capiRow, { eventName: "Lead", eventId: "lead_abc12345", user: {} });
    expect(r).toMatchObject({ ok: false, code: "invalid_token" });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    const logged = h.prisma.operationalEvent.create.mock.calls[0][0];
    expect(JSON.stringify(logged)).not.toContain(TOKEN);
    fetchMock.mockRejectedValueOnce(new Error("socket"));
    expect(await sendCapiEvent(capiRow, { eventName: "Lead", eventId: "lead_abc12345", user: {} })).toEqual({ ok: false, code: "network" });
  });

  it("test_event_code salvo vai junto", async () => {
    await sendCapiEvent({ ...capiRow!, testEventCode: "TEST123" }, { eventName: "PageView", eventId: "test_abc12345", user: {} });
    expect(sentBodies()[0].test_event_code).toBe("TEST123");
  });
});

describe("quiz: Lead e InitiateCheckout", () => {
  it("Lead com o mesmo event_id do Pixel, dados com hash, ip/ua da visita e url sem dados pessoais", async () => {
    const res = await lead({ adConsent: "accepted", eventId: "lead_0011223344556677", fbp: "fb.1.1760000000000.123456789" });
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const ev = sentBodies()[0].data[0];
    expect(ev).toMatchObject({ event_name: "Lead", event_id: "lead_0011223344556677", action_source: "website" });
    expect(ev.event_source_url).toBe("https://app.example.com/q/chat");
    expect(ev.user_data.em).toEqual([sha256("ana@ex.com")]);
    expect(ev.user_data.ph).toEqual([sha256("5511999998888")]);
    expect(ev.user_data.client_ip_address).toBe("1.2.3.4");
    expect(ev.user_data.client_user_agent).toContain("iPhone");
    expect(ev.user_data.fbp).toBe("fb.1.1760000000000.123456789");
    const visit = h.prisma.funnelVisit.upsert.mock.calls[0][0];
    expect(visit.create).toMatchObject({ adConsent: true, clientIp: "1.2.3.4", fbp: "fb.1.1760000000000.123456789" });
  });

  it("InitiateCheckout no clique do checkout, fbc montado do fbclid da entrada", async () => {
    await event({ type: "checkout", stepId: "s2", blockId: "b3", adConsent: "accepted", eventId: "ic_aabbccddeeff0011", tracking: { fbclid: "IwAR123abc" } });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const ev = sentBodies()[0].data[0];
    expect(ev).toMatchObject({ event_name: "InitiateCheckout", event_id: "ic_aabbccddeeff0011" });
    expect(ev.user_data.fbc).toBe(`fb.1.${CREATED.getTime()}.IwAR123abc`);
  });

  it("modo banner sem Aceitar (ou Não agora) = não manda e não guarda ip/ua", async () => {
    await lead({ eventId: "lead_0011223344556677" });
    await event({ type: "checkout", stepId: "s2", blockId: "b3", adConsent: "declined", eventId: "ic_aabbccddeeff0011" });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    for (const call of h.prisma.funnelVisit.upsert.mock.calls) {
      expect(call[0].create).toMatchObject({ adConsent: false, clientIp: null, clientUserAgent: null });
      expect(call[0].update).toMatchObject({ adConsent: false, clientIp: null });
    }
  });

  it("modo notice (só avisa) já vale sem clique", async () => {
    h.prisma.funnel.findUnique.mockImplementation(async () => funnelRow({ pixelConsent: "notice" }));
    await event({ type: "checkout", stepId: "s2", blockId: "b3", eventId: "ic_aabbccddeeff0011" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("conta sem token = nada vai pra Meta e ip/ua não são guardados", async () => {
    capiRow = { pixelId: PIXEL, accessTokenEnc: null, testEventCode: null };
    await lead({ adConsent: "accepted", eventId: "lead_0011223344556677" });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    const create = h.prisma.funnelVisit.upsert.mock.calls[0][0].create;
    expect(create.adConsent).toBe(true);
    expect(create.clientIp).toBeUndefined();
  });

  it("quiz com Pixel próprio manda pro Pixel dele; sem Pixel próprio usa o da conta", async () => {
    h.prisma.funnel.findUnique.mockImplementation(async () => funnelRow({ pixelId: "999999999" }));
    await lead({ adConsent: "accepted", eventId: "lead_0011223344556677" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0][0])).toContain("/999999999/events");
  });
});

describe("página pública", () => {
  it("quiz sem Pixel usa o padrão da conta e nada da configuração CAPI vai pro navegador", async () => {
    const funnel = await getPublishedFunnelBySlug("chat");
    expect(funnel?.settings.pixelId).toBe(PIXEL);
    const text = JSON.stringify(funnel);
    expect(text).not.toContain("accessTokenEnc");
    expect(text).not.toContain(capiRow!.accessTokenEnc!);
    expect(text).not.toContain("capi");
    expect(text).not.toContain("ws_A");
  });
});

describe("Hotmart: Purchase", () => {
  const purchasePayload = {
    event: "PURCHASE_APPROVED",
    creation_date: Date.now() - 1000,
    data: {
      product: { id: 123, name: "Chat Sem Frescura" },
      buyer: { email: "Ana@Ex.com" },
      purchase: {
        transaction: "HP123",
        status: "APPROVED",
        price: { value: 97, currency_value: "BRL" },
        origin: { sck: "instagram_reel", xcod: VISITOR },
      },
    },
  };

  function storedVisit(over: Record<string, unknown> = {}) {
    return {
      visitorId: VISITOR,
      createdAt: CREATED,
      tracking: { fbclid: "IwAR123abc" },
      adConsent: true,
      clientIp: "9.9.9.9",
      clientUserAgent: "Mozilla/5.0 Android Mobile",
      fbp: "fb.1.1760000000000.123456789",
      fbc: null,
      workspaceId: "ws_A",
      lead: { name: "Ana Souza", email: "ana@ex.com", phone: "5511999998888" },
      funnel: { slug: "chat", name: "Chat", published: def(), workspace: { metaCapi: capiRow } },
      ...over,
    };
  }

  beforeEach(() => {
    h.prisma.funnelVisit.findFirst.mockResolvedValue({ id: "v_1", funnelId: "f_1", workspaceId: "ws_A", contactId: null });
    h.prisma.funnelLead.findUnique.mockResolvedValue({ id: "l_1", contactId: null });
    h.prisma.funnelPurchase.createMany.mockResolvedValue({ count: 1 });
    h.prisma.funnelVisit.updateMany.mockResolvedValue({ count: 1 });
    h.prisma.funnelLead.updateMany.mockResolvedValue({ count: 1 });
  });

  it("compra aprovada que casa pelo xcod manda Purchase com value/currency e o ip/ua/fbc/fbp da visita", async () => {
    h.prisma.funnelVisit.findUnique.mockResolvedValue(storedVisit());
    await applyHotmartPurchase(parseHotmartPayload(purchasePayload)!);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const ev = sentBodies()[0].data[0];
    expect(ev).toMatchObject({
      event_name: "Purchase",
      event_id: "purchase_HP123",
      action_source: "website",
      custom_data: { value: 97, currency: "BRL", content_name: "Chat Sem Frescura" },
    });
    expect(ev.user_data).toMatchObject({
      client_ip_address: "9.9.9.9",
      client_user_agent: "Mozilla/5.0 Android Mobile",
      fbp: "fb.1.1760000000000.123456789",
      fbc: `fb.1.${CREATED.getTime()}.IwAR123abc`,
      em: [sha256("ana@ex.com")],
    });
    expect(ev.event_source_url).toBe("https://app.example.com/q/chat");
  });

  it("visita sem consentimento, conta sem token ou compra repetida = não manda", async () => {
    h.prisma.funnelVisit.findUnique.mockResolvedValue(storedVisit({ adConsent: false }));
    await applyHotmartPurchase(parseHotmartPayload(purchasePayload)!);
    h.prisma.funnelVisit.findUnique.mockResolvedValue(
      storedVisit({ funnel: { slug: "chat", name: "Chat", published: def(), workspace: { metaCapi: { ...capiRow, accessTokenEnc: null } } } })
    );
    await applyHotmartPurchase(parseHotmartPayload({ ...purchasePayload, event: "PURCHASE_COMPLETE" })!);
    // Second approved event of the same visit: purchasedAt already set.
    h.prisma.funnelVisit.findUnique.mockResolvedValue(storedVisit());
    h.prisma.funnelVisit.updateMany.mockResolvedValue({ count: 0 });
    await applyHotmartPurchase(parseHotmartPayload({ ...purchasePayload, event: "PURCHASE_COMPLETE" })!);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Configurações: token nunca volta", () => {
  const patch = (body: unknown) =>
    capiRoute.PATCH(
      new NextRequest(new URL("/api/workspace/meta-capi", "http://localhost"), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
    );

  it("salva o token criptografado e responde só os 4 últimos", async () => {
    h.prisma.metaCapiSettings.upsert.mockImplementation(async (args: { create: Record<string, unknown> }) => ({
      pixelId: args.create.pixelId,
      accessTokenEnc: args.create.accessTokenEnc,
      tokenLast4: args.create.tokenLast4,
      testEventCode: args.create.testEventCode,
      updatedAt: new Date(),
    }));
    const res = await patch({ pixelId: PIXEL, accessToken: TOKEN, testEventCode: "TEST123" });
    expect(res.status).toBe(200);
    const text = await res.text();
    const saved = h.prisma.metaCapiSettings.upsert.mock.calls[0][0].create;
    expect(saved.accessTokenEnc).not.toBe(TOKEN);
    expect(decryptToken(saved.accessTokenEnc)).toBe(TOKEN);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(saved.accessTokenEnc);
    expect(JSON.parse(text).data).toEqual({
      pixelId: PIXEL,
      tokenSaved: true,
      tokenLast4: "abcd",
      testEventCode: "TEST123",
      updatedAt: expect.any(String),
    });
  });

  it("GET nunca devolve o token nem o criptografado", async () => {
    h.prisma.metaCapiSettings.findUnique.mockResolvedValue({ ...capiRow, tokenLast4: "abcd", updatedAt: new Date() });
    const text = await (await capiRoute.GET()).text();
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(capiRow!.accessTokenEnc!);
    expect(JSON.parse(text).data).toMatchObject({ tokenSaved: true, tokenLast4: "abcd", pixelId: PIXEL });
  });

  it("Pixel ou token inválido = 400; null remove o token", async () => {
    expect((await patch({ pixelId: "12ab" })).status).toBe(400);
    expect((await patch({ accessToken: "curto" })).status).toBe(400);
    h.prisma.metaCapiSettings.upsert.mockResolvedValue({ pixelId: PIXEL, accessTokenEnc: null, tokenLast4: null, testEventCode: null, updatedAt: new Date() });
    const res = await patch({ accessToken: null });
    expect(h.prisma.metaCapiSettings.upsert.mock.calls[0][0].update).toMatchObject({ accessTokenEnc: null, tokenLast4: null });
    expect((await res.json()).data.tokenSaved).toBe(false);
  });

  it("evento de teste: PageView, mostra events_received e o token não aparece", async () => {
    h.prisma.metaCapiSettings.findUnique.mockResolvedValue({ ...capiRow, testEventCode: "TEST123" });
    const res = await capiTestRoute.POST(post("/api/workspace/meta-capi/test", {}));
    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    expect(JSON.parse(text).data).toMatchObject({ ok: true, eventsReceived: 1, testEventCode: true });
    const body = sentBodies()[0];
    expect(body.data[0].event_name).toBe("PageView");
    expect(body.test_event_code).toBe("TEST123");
  });

  it("membro comum = 403", async () => {
    h.role = "MEMBER";
    expect((await capiRoute.GET()).status).toBe(403);
    expect((await patch({ pixelId: PIXEL })).status).toBe(403);
    expect((await capiTestRoute.POST(post("/api/workspace/meta-capi/test", {}))).status).toBe(403);
  });
});

describe("chave de API não alcança", () => {
  it("proxy.ts responde 403 human_only pra Authorization em todas as rotas novas", async () => {
    for (const [method, path] of [
      ["GET", "/api/workspace/meta-capi"],
      ["PATCH", "/api/workspace/meta-capi"],
      ["POST", "/api/workspace/meta-capi/test"],
    ] as const) {
      expect(isApiKeyRouteAllowed(method, path)).toBe(false);
      const res = await proxy(new NextRequest(new URL(path, "http://localhost"), { method, headers: { authorization: "Bearer lek_123" } }));
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("human_only");
    }
  });

  it("e a própria rota também recusa (segunda tranca)", async () => {
    h.byKey = true;
    expect((await capiRoute.GET()).status).toBe(403);
    expect((await capiTestRoute.POST(post("/api/workspace/meta-capi/test", {}))).status).toBe(403);
    expect(h.prisma.metaCapiSettings.findUnique).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
