/**
 * Webhook da Hotmart sem perder o sck: reembolso/chargeback que chega sem
 * origem herda sck, xcod e a visita do primeiro evento da mesma transação;
 * evento repetido não duplica; todos os eventos de compra são gravados.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  created: [] as Record<string, unknown>[],
  prior: null as Record<string, unknown> | null,
  visitUpdates: [] as unknown[],
}));
vi.mock("@/lib/db/client", () => ({
  prisma: {
    funnelVisit: { findFirst: vi.fn(async () => null), updateMany: vi.fn(async (a: unknown) => { h.visitUpdates.push(a); return { count: 1 }; }), findUnique: vi.fn(async () => null) },
    funnelLead: { findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => null), updateMany: vi.fn(async () => ({ count: 1 })) },
    funnelPurchase: {
      findFirst: vi.fn(async () => h.prior),
      createMany: vi.fn(async (a: { data: Record<string, unknown>[] }) => { h.created.push(...a.data); return { count: a.data.length }; }),
    },
  },
}));
vi.mock("@/lib/contacts/record", () => ({ addTag: vi.fn(async () => true), recordEvent: vi.fn(async () => true), AUTO_TAGS: { bought: (p: string) => `comprou:${p}`, refunded: (p: string) => `reembolso:${p}` } }));

import { applyHotmartPurchase, parseHotmartPayload } from "../lib/funnels/hotmart";

const body = (event: string, origin: Record<string, unknown> | null, tx = "HP9") => ({
  event, creation_date: 1_761_000_000_000,
  data: { product: { id: 1, name: "CSF" }, buyer: { email: "a@b.com" }, purchase: { transaction: tx, status: event.replace("PURCHASE_", ""), ...(origin ? { origin } : {}), price: { value: 97, currency_value: "BRL" } } },
});

describe("webhook Hotmart: eventos e sck", () => {
  beforeEach(() => { h.created.length = 0; h.prior = null; h.visitUpdates.length = 0; });

  it("lê os cinco eventos e guarda o sck", () => {
    for (const ev of ["PURCHASE_APPROVED", "PURCHASE_COMPLETE", "PURCHASE_REFUNDED", "PURCHASE_CHARGEBACK", "PURCHASE_CANCELED"]) {
      const p = parseHotmartPayload(body(ev, { sck: "quero-a-checkout" }));
      expect(p).toMatchObject({ event: ev, transaction: "HP9", sck: "quero-a-checkout", amountCents: 9700 });
    }
  });

  it("sck no nível da compra também é guardado", () => {
    const p = parseHotmartPayload({ ...body("PURCHASE_APPROVED", null), data: { ...body("PURCHASE_APPROVED", null).data, purchase: { transaction: "T", sck: "so-na-compra" } } });
    expect(p?.sck).toBe("so-na-compra");
  });

  it("evento posterior sem origem herda sck, xcod e a visita da venda", async () => {
    h.prior = { workspaceId: "w1", funnelId: "q1", visitId: "v1", leadId: null, contactId: null, sck: "quero-a-checkout", src: null, xcod: "0123456789abcdef0123456789abcdef" };
    const res = await applyHotmartPurchase(parseHotmartPayload(body("PURCHASE_REFUNDED", null))!);
    expect(res).toEqual({ matched: true, duplicate: false });
    expect(h.created[0]).toMatchObject({ sck: "quero-a-checkout", xcod: "0123456789abcdef0123456789abcdef", visitId: "v1", workspaceId: "w1", event: "PURCHASE_REFUNDED" });
    expect(h.visitUpdates).toHaveLength(1);
  });

  it("sem evento anterior e sem match: grava mesmo assim, com o sck", async () => {
    const res = await applyHotmartPurchase(parseHotmartPayload(body("PURCHASE_APPROVED", { sck: "quero-b-pagina" }))!);
    expect(res.matched).toBe(false);
    expect(h.created[0]).toMatchObject({ workspaceId: null, sck: "quero-b-pagina", buyerEmailHash: expect.any(String) });
    expect(JSON.stringify(h.created[0])).not.toContain("a@b.com");
  });
});
