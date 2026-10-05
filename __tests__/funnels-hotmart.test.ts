/**
 * Etapa 6: webhook da Hotmart. Sem HOTMART_HOTTOK = 503; token errado = 401
 * (tamanhos diferentes não lançam); certo + xcod marca visita e lead como
 * compra e etiqueta o contato; repetido não muda nada; sem xcod casa pelo
 * e-mail; reembolso marca refundedAt; corpo grande = 413.
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
    addTag: vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true),
    recordEvent: vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => true),
  };
});

vi.mock("@/lib/db/client", () => ({ prisma: h.prisma }));
vi.mock("@/lib/workspace-access", () => ({ getCurrentWorkspaceContext: vi.fn(async () => null), canManageWorkspace: () => false }));
vi.mock("@/lib/auth", () => ({ getApiCaller: vi.fn(async () => ({ kind: "none" })) }));
vi.mock("@/lib/contacts/record", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/contacts/record")>();
  return { ...real, addTag: h.addTag, recordEvent: h.recordEvent };
});

import * as hotmart from "../app/api/webhooks/hotmart/route";
import { hottokMatches, parseHotmartPayload } from "../lib/funnels/hotmart";

const HOTTOK = "segredo-da-hotmart-123";
const VISITOR = "0123456789abcdef0123456789abcdef";

function payload(over: { event?: string; xcod?: string | null; email?: string; transaction?: string } = {}) {
  return {
    id: "evt-1",
    creation_date: 1_760_000_000_000,
    event: over.event ?? "PURCHASE_APPROVED",
    version: "2.0.0",
    data: {
      product: { id: 123, name: "Chat Sem Frescura" },
      buyer: { email: over.email ?? "Ana@Ex.com" },
      purchase: {
        transaction: over.transaction ?? "HP123",
        status: "APPROVED",
        price: { value: 97, currency_value: "BRL" },
        offer: { code: "off1" },
        origin: { src: "bio", sck: "instagram_reel", ...(over.xcod === null ? {} : { xcod: over.xcod ?? VISITOR }) },
      },
    },
  };
}

function call(body: unknown, headers: Record<string, string> = { "x-hotmart-hottok": HOTTOK }) {
  return hotmart.POST(
    new NextRequest(new URL("/api/webhooks/hotmart", "http://localhost"), {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );
}

function resetModels() {
  for (const m of h.models.values()) for (const key of Object.keys(m)) delete m[key];
}

beforeEach(() => {
  vi.clearAllMocks();
  resetModels();
  vi.unstubAllEnvs();
  vi.stubEnv("HOTMART_HOTTOK", HOTTOK);
  h.prisma.funnelPurchase.createMany.mockResolvedValue({ count: 1 });
  h.prisma.funnelVisit.updateMany.mockResolvedValue({ count: 1 });
  h.prisma.funnelLead.updateMany.mockResolvedValue({ count: 1 });
});

describe("autenticação", () => {
  it("sem HOTMART_HOTTOK = 503 not_configured", async () => {
    vi.stubEnv("HOTMART_HOTTOK", "");
    const res = await call(payload());
    expect(res.status).toBe(503);
    expect((await res.json()).details.code).toBe("not_configured");
    expect(h.prisma.funnelPurchase.createMany).not.toHaveBeenCalled();
  });

  it("token errado = 401; tamanho diferente não lança", async () => {
    expect((await call(payload(), { "x-hotmart-hottok": "errado" })).status).toBe(401);
    expect((await call(payload(), { "x-hotmart-hottok": HOTTOK + "x" })).status).toBe(401);
    expect((await call(payload(), {})).status).toBe(401);
    expect(hottokMatches("a", "abc")).toBe(false);
    expect(hottokMatches("", "abc")).toBe(false);
    expect(hottokMatches(HOTTOK, HOTTOK)).toBe(true);
    expect(h.prisma.funnelPurchase.createMany).not.toHaveBeenCalled();
  });

  it("v1: hottok no corpo também vale", async () => {
    const res = await call({ ...payload(), hottok: HOTTOK }, {});
    expect(res.status).toBe(200);
  });

  it("corpo grande = 413; JSON ruim = 400", async () => {
    const big = await call("x".repeat(262_145));
    expect(big.status).toBe(413);
    expect((await call("{nada")).status).toBe(400);
  });
});

describe("compra", () => {
  it("certo + xcod: visita e lead com purchasedAt, contato com comprou:<produto>", async () => {
    h.prisma.funnelVisit.findFirst.mockResolvedValue({ id: "v_1", funnelId: "f_1", workspaceId: "ws_A", contactId: "c_1" });
    h.prisma.funnelLead.findUnique.mockResolvedValue({ id: "l_1", contactId: "c_1" });
    const res = await call(payload());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ received: true, matched: true });
    expect(h.prisma.funnelVisit.findFirst.mock.calls[0][0].where).toEqual({ visitorId: VISITOR });
    const row = h.prisma.funnelPurchase.createMany.mock.calls[0][0];
    expect(row.skipDuplicates).toBe(true);
    expect(row.data[0]).toMatchObject({
      workspaceId: "ws_A",
      funnelId: "f_1",
      visitId: "v_1",
      leadId: "l_1",
      transaction: "HP123",
      event: "PURCHASE_APPROVED",
      amountCents: 9700,
      productName: "Chat Sem Frescura",
      xcod: VISITOR,
    });
    expect(JSON.stringify(row.data[0])).not.toContain("ex.com");
    expect(row.data[0].buyerEmailHash).toMatch(/^[a-f0-9]{64}$/);
    expect(h.prisma.funnelVisit.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "v_1", purchasedAt: null } });
    expect(h.prisma.funnelLead.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "l_1", purchasedAt: null } });
    expect(h.addTag.mock.calls[0][1]).toBe("comprou:Chat Sem Frescura");
    expect(h.recordEvent.mock.calls[0][1]).toMatchObject({ type: "PURCHASE", refId: "HP123" });
  });

  it("repetido = idempotente (nada muda de novo)", async () => {
    h.prisma.funnelVisit.findFirst.mockResolvedValue({ id: "v_1", funnelId: "f_1", workspaceId: "ws_A", contactId: "c_1" });
    h.prisma.funnelPurchase.createMany.mockResolvedValue({ count: 0 });
    const res = await call(payload());
    expect(res.status).toBe(200);
    expect(h.prisma.funnelVisit.updateMany).not.toHaveBeenCalled();
    expect(h.addTag).not.toHaveBeenCalled();
  });

  it("sem xcod casa pelo e-mail do lead mais recente", async () => {
    h.prisma.funnelLead.findFirst.mockResolvedValue({ id: "l_2", visitId: "v_2", funnelId: "f_1", workspaceId: "ws_A", contactId: null });
    const res = await call(payload({ xcod: null }));
    expect((await res.json()).data.matched).toBe(true);
    expect(h.prisma.funnelVisit.findFirst).not.toHaveBeenCalled();
    expect(h.prisma.funnelLead.findFirst.mock.calls[0][0]).toMatchObject({ where: { email: "ana@ex.com" }, orderBy: { createdAt: "desc" } });
    expect(h.prisma.funnelVisit.updateMany.mock.calls[0][0].where.id).toBe("v_2");
    expect(h.addTag).not.toHaveBeenCalled();
  });

  it("reembolso marca refundedAt e etiqueta reembolso:<produto>", async () => {
    h.prisma.funnelVisit.findFirst.mockResolvedValue({ id: "v_1", funnelId: "f_1", workspaceId: "ws_A", contactId: "c_1" });
    await call(payload({ event: "PURCHASE_REFUNDED" }));
    expect(h.prisma.funnelVisit.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: "v_1", refundedAt: null } });
    expect(h.addTag.mock.calls[0][1]).toBe("reembolso:Chat Sem Frescura");
  });

  it("não casou = 200 matched:false, linha gravada sem funil", async () => {
    const res = await call(payload({ xcod: "nao-e-visitor" }));
    expect((await res.json()).data).toEqual({ received: true, matched: false });
    expect(h.prisma.funnelPurchase.createMany.mock.calls[0][0].data[0].funnelId).toBeNull();
  });

  it("parse: v2 e payload sem transação", () => {
    expect(parseHotmartPayload(payload())).toMatchObject({ event: "PURCHASE_APPROVED", transaction: "HP123", buyerEmail: "ana@ex.com", currency: "BRL" });
    expect(parseHotmartPayload({ event: "PURCHASE_APPROVED", data: { purchase: {} } })).toBeNull();
    expect(parseHotmartPayload({ transaction: "T1", status: "refunded", prod_name: "X" })).toMatchObject({ event: "PURCHASE_REFUNDED" });
  });
});
