/**
 * Etapa 2 (pendência da Etapa 1): o CRM da DM saiu de dentro da requisição do
 * webhook. A rota só grava a mensagem e enfileira CRM_DM_JOB (idempotente pelo
 * mid) e REFERRAL_JOB para links ig.me.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "crypto";

const { mockPrisma, mockAdd, mockStore, mockTrack, mockOnDm } = vi.hoisted(() => ({
  mockPrisma: {
    webhookEvent: { create: vi.fn(async () => ({ id: "we_1" })), update: vi.fn() },
    instagramAccount: { findUnique: vi.fn(async () => ({ workspaceId: "ws" })) },
    dmLog: { findMany: vi.fn(async () => []) },
    operationalEvent: { create: vi.fn() },
  },
  mockAdd: vi.fn(),
  mockStore: vi.fn(async () => []),
  mockTrack: vi.fn(),
  mockOnDm: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/queue/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/queue/client")>();
  return { ...real, getDMQueue: () => ({ add: mockAdd }) };
});
vi.mock("@/lib/messages/store", () => ({ storeParsedDirectMessages: mockStore }));
vi.mock("@/lib/contacts/record", () => ({ trackInteraction: mockTrack, onDirectMessage: mockOnDm }));

import { POST } from "../app/api/webhook/route";

const SECRET = "test_app_secret_12345";

function signed(payload: unknown) {
  const body = JSON.stringify(payload);
  const sig = "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
  return new NextRequest(new URL("/api/webhook", "http://localhost"), {
    method: "POST",
    body,
    headers: { "content-type": "application/json", "x-hub-signature-256": sig },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("FACEBOOK_APP_SECRET", SECRET);
});

describe("webhook: CRM out of the request", () => {
  it("stores the DM, queues CRM_DM_JOB by mid and never runs the CRM inline", async () => {
    const res = await POST(
      signed({
        object: "instagram",
        entry: [
          {
            id: "ig_owner",
            time: 1,
            messaging: [
              { sender: { id: "ig_person" }, recipient: { id: "ig_owner" }, timestamp: 1_700_000_000_000, message: { mid: "mid:in/1", text: "quero" } },
              {
                sender: { id: "ig_owner" },
                recipient: { id: "ig_person" },
                timestamp: 1_700_000_000_500,
                message: { mid: "mid_out", text: "aqui", is_echo: true, metadata: "le:automation:r1" },
              },
            ],
          },
        ],
      })
    );
    expect(res.status).toBe(200);
    expect(mockStore).toHaveBeenCalledTimes(1);
    expect(mockTrack).not.toHaveBeenCalled();
    expect(mockOnDm).not.toHaveBeenCalled();

    const crm = mockAdd.mock.calls.filter((c) => c[0] === "crm-dm");
    expect(crm.map((c) => c[1].mid)).toEqual(["mid:in/1", "mid_out"]);
    expect(crm[0][2].jobId).toBe(`crm_${Buffer.from("mid:in/1").toString("base64url")}`);
    expect(crm[0][2].jobId).not.toContain(":");
    expect(crm[1][1]).toMatchObject({ fromMe: true, metadata: "le:automation:r1", igUserId: "ig_person" });
    // The keyword autoreply still gets the inbound DM.
    expect(mockAdd.mock.calls.some((c) => c[0] === "process-message")).toBe(true);
  });

  it("queues a REFERRAL_JOB for an ig.me link into an existing thread", async () => {
    await POST(
      signed({
        object: "instagram",
        entry: [
          {
            id: "ig_owner",
            time: 1,
            messaging: [
              {
                sender: { id: "ig_person" },
                recipient: { id: "ig_owner" },
                timestamp: 1_700_000_000_000,
                referral: { ref: "story1", source: "SHORTLINKS", type: "OPEN_THREAD" },
              },
            ],
          },
        ],
      })
    );
    const ref = mockAdd.mock.calls.find((c) => c[0] === "process-referral");
    expect(ref?.[1]).toMatchObject({ igUserId: "ig_person", ref: "story1", kind: "referral" });
    expect(ref?.[2].jobId).not.toContain(":");
  });
});
