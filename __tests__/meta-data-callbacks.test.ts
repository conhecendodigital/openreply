/**
 * Revisão do app da Meta (06/10/2026): callbacks de desautorização e de
 * exclusão de dados, num Postgres de verdade (PGlite) com todas as migrações.
 *  - signed_request: assinatura válida, inválida, segredo errado, algoritmo
 *    errado, payload malformado, sem user_id;
 *  - desautorizar só desliga a conta e apaga o token (conversas, contatos e
 *    automações ficam, regra do dono);
 *  - excluir apaga tudo da conta certa, incluindo os webhooks brutos dela,
 *    sem tocar na outra conta, e grava o pedido com código pra página de status;
 *  - id que não bate com nenhuma conta: registra o pedido e não apaga nada.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import type { PGlite } from "@electric-sql/pglite";
import type { PrismaClient } from "../app/generated/prisma/client";
import { migratedDb, startPrisma } from "./helpers/pglite-db";
import { parseSignedRequest, signSignedRequest, signedRequestSecrets } from "../lib/meta/signed-request";

const h = vi.hoisted(() => ({
  prisma: null as unknown as PrismaClient,
  unsubscribe: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/lib/db/client", () => ({
  get prisma() {
    return h.prisma;
  },
  getPrisma: () => h.prisma,
}));
vi.mock("@/lib/contacts/record", () => ({ clearAccountCache: () => undefined }));
vi.mock("@/lib/meta/client", () => ({ unsubscribeInstagramAccountFromWebhooks: h.unsubscribe }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => `plain:${t}` }));

import * as deauthorizeRoute from "../app/api/instagram/deauthorize/route";
import * as deletionRoute from "../app/api/instagram/data-deletion/route";
import { getDeletionStatus } from "../lib/meta/data-callbacks";
import { withRls } from "../lib/db/rls";

const SECRET = "test-instagram-app-secret";

function signed(payload: Record<string, unknown>, secret = SECRET) {
  return signSignedRequest(payload, secret);
}

function form(path: string, signedRequest: string | null) {
  const body = signedRequest === null ? "" : new URLSearchParams({ signed_request: signedRequest }).toString();
  return new NextRequest(`https://app.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

describe("signed_request (lib/meta/signed-request.ts)", () => {
  const good = { algorithm: "HMAC-SHA256", issued_at: 1_791_000_000, user_id: "17841400000000001" };

  it("valid signature: returns the payload with user_id as text", () => {
    const result = parseSignedRequest(signed(good), [SECRET]);
    expect(result).toEqual({ ok: true, payload: expect.objectContaining({ user_id: "17841400000000001" }) });
  });

  it("invalid signature: tampered payload or wrong secret is rejected", () => {
    const [sig] = signed(good).split(".");
    const forged = Buffer.from(JSON.stringify({ ...good, user_id: "999" })).toString("base64url");
    expect(parseSignedRequest(`${sig}.${forged}`, [SECRET])).toEqual({ ok: false, reason: "bad_signature" });
    expect(parseSignedRequest(signed(good, "other-secret"), [SECRET])).toEqual({ ok: false, reason: "bad_signature" });
    // signature of a different length never reaches timingSafeEqual with a mismatch
    const body = signed(good).split(".")[1];
    expect(parseSignedRequest(`abc.${body}`, [SECRET])).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("wrong algorithm is rejected even when correctly signed", () => {
    expect(parseSignedRequest(signed({ ...good, algorithm: "HMAC-SHA1" }), [SECRET])).toEqual({
      ok: false,
      reason: "bad_algorithm",
    });
    expect(parseSignedRequest(signed({ ...good, algorithm: undefined }), [SECRET])).toEqual({
      ok: false,
      reason: "bad_algorithm",
    });
  });

  it("malformed payloads are rejected", () => {
    expect(parseSignedRequest("", [SECRET])).toEqual({ ok: false, reason: "missing" });
    expect(parseSignedRequest(null, [SECRET])).toEqual({ ok: false, reason: "missing" });
    expect(parseSignedRequest("no-dot-here", [SECRET])).toEqual({ ok: false, reason: "malformed" });
    expect(parseSignedRequest("a.b.c", [SECRET])).toEqual({ ok: false, reason: "malformed" });
    expect(parseSignedRequest("%%%.###", [SECRET])).toEqual({ ok: false, reason: "malformed" });
    // correctly signed, but the payload is not JSON / not an object
    const notJson = Buffer.from("not json").toString("base64url");
    const sigNotJson = createHmac("sha256", SECRET).update(notJson).digest("base64url");
    expect(parseSignedRequest(`${sigNotJson}.${notJson}`, [SECRET])).toEqual({ ok: false, reason: "malformed" });
    const arr = Buffer.from("[1,2]").toString("base64url");
    const sigArr = createHmac("sha256", SECRET).update(arr).digest("base64url");
    expect(parseSignedRequest(`${sigArr}.${arr}`, [SECRET])).toEqual({ ok: false, reason: "malformed" });
  });

  it("user_id must be digits (a number only when it is a safe integer)", () => {
    expect(parseSignedRequest(signed({ algorithm: "HMAC-SHA256" }), [SECRET])).toEqual({ ok: false, reason: "no_user" });
    expect(parseSignedRequest(signed({ ...good, user_id: "abc" }), [SECRET])).toEqual({ ok: false, reason: "no_user" });
    expect(parseSignedRequest(signed({ ...good, user_id: 1e20 }), [SECRET])).toEqual({ ok: false, reason: "no_user" });
    const n = parseSignedRequest(signed({ ...good, user_id: 218471 }), [SECRET]);
    expect(n.ok && n.payload.user_id).toBe("218471");
  });

  it("no secret configured: refuses; a second secret (Meta app) also works", () => {
    expect(parseSignedRequest(signed(good), [])).toEqual({ ok: false, reason: "no_secret" });
    expect(parseSignedRequest(signed(good), ["", undefined])).toEqual({ ok: false, reason: "no_secret" });
    expect(parseSignedRequest(signed(good, "fb-secret"), ["ig-secret", "fb-secret"]).ok).toBe(true);
    expect(signedRequestSecrets({ INSTAGRAM_APP_SECRET: "a", FACEBOOK_APP_SECRET: " " })).toEqual(["a"]);
  });
});

let db: PGlite;
let stop: () => Promise<void>;

const APP_SCOPED_A = "26000000000000001"; // what Meta sends in signed_request
const IG_ID_A = "17841400000000001"; // professional account id (webhooks)
const IG_ID_B = "17841400000000002";

async function seed() {
  await db.exec(`
    DELETE FROM "DataDeletionRequest";
    DELETE FROM "WebhookEvent";
    DELETE FROM "OperationalEvent";
    DELETE FROM "DirectMessage";
    DELETE FROM "Contact";
    DELETE FROM "Automation";
    DELETE FROM "InstagramAccount";
    DELETE FROM "WorkspaceMember";
    DELETE FROM "Workspace";
    DELETE FROM "User";
    INSERT INTO "User"(id, email, "updatedAt") VALUES ('u_a', 'a@ex.com', now()), ('u_b', 'b@ex.com', now());
    INSERT INTO "Workspace"(id, name, "ownerId", "updatedAt") VALUES ('ws_a', 'A', 'u_a', now()), ('ws_b', 'B', 'u_b', now());
    INSERT INTO "InstagramAccount"(id, "workspaceId", "instagramId", "appScopedId", username, "accessToken", "updatedAt") VALUES
      ('acc_a', 'ws_a', '${IG_ID_A}', '${APP_SCOPED_A}', 'conta.a', 'enc-a', now()),
      ('acc_b', 'ws_b', '${IG_ID_B}', NULL, 'conta.b', 'enc-b', now());
    INSERT INTO "Automation"(id, "workspaceId", "instagramAccountId", name, keywords, "dmMessage", "updatedAt") VALUES
      ('auto_a', 'ws_a', 'acc_a', 'Campanha A', ARRAY['LINK'], 'oi', now()),
      ('auto_b', 'ws_b', 'acc_b', 'Campanha B', ARRAY['LINK'], 'oi', now());
    INSERT INTO "Contact"(id, "workspaceId", "instagramAccountId", "igUserId", "firstSeenAt", "lastSeenAt", "updatedAt") VALUES
      ('ct_a', 'ws_a', 'acc_a', 'igsid_1', now(), now(), now()),
      ('ct_b', 'ws_b', 'acc_b', 'igsid_2', now(), now(), now());
    INSERT INTO "DirectMessage"(id, "accountId", "contactId", mid, "fromMe", "sentAt") VALUES
      ('dm_a', '${IG_ID_A}', 'igsid_1', 'mid_a', false, now()),
      ('dm_b', '${IG_ID_B}', 'igsid_2', 'mid_b', false, now());
    INSERT INTO "WebhookEvent"(id, object, payload) VALUES
      ('wh_a', 'instagram', '{"object":"instagram","entry":[{"id":"${IG_ID_A}","changes":[{"value":{"text":"LINK"}}]}]}'),
      ('wh_b', 'instagram', '{"object":"instagram","entry":[{"id":"${IG_ID_B}"}]}'),
      ('wh_odd', 'instagram', '{"object":"instagram","entry":{"id":"${IG_ID_A}"}}');
  `);
}

async function count(table: string, where = "true"): Promise<number> {
  const res = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM "${table}" WHERE ${where}`);
  return res.rows[0].n;
}

beforeAll(async () => {
  db = await migratedDb();
  ({ prisma: h.prisma, stop } = await startPrisma(db));
  process.env.INSTAGRAM_APP_SECRET = SECRET;
  process.env.NEXTAUTH_URL = "https://many.leadenginer.com";
}, 60_000);

afterAll(async () => {
  await stop?.();
  await db?.close();
});

beforeEach(async () => {
  h.unsubscribe.mockClear();
  await seed();
});

describe("POST /api/instagram/deauthorize", () => {
  it("disconnects the account and wipes the token, deletes nothing else", async () => {
    const res = await deauthorizeRoute.POST(
      form("/api/instagram/deauthorize", signed({ algorithm: "HMAC-SHA256", user_id: APP_SCOPED_A }))
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, result: "disconnected" });

    const acc = await db.query<{ status: string; accessToken: string; webhookSubscribed: boolean }>(
      `SELECT status, "accessToken", "webhookSubscribed" FROM "InstagramAccount" WHERE id = 'acc_a'`
    );
    expect(acc.rows[0]).toEqual({ status: "DISCONNECTED", accessToken: "", webhookSubscribed: false });
    // owner's rule: conversations, contacts and automations stay
    expect(await count("Automation", `id = 'auto_a'`)).toBe(1);
    expect(await count("Contact", `id = 'ct_a'`)).toBe(1);
    expect(await count("DirectMessage", `id = 'dm_a'`)).toBe(1);
    expect(await count("WebhookEvent")).toBe(3);
    // the other account is untouched
    const b = await db.query<{ status: string }>(`SELECT status FROM "InstagramAccount" WHERE id = 'acc_b'`);
    expect(b.rows[0].status).toBe("ACTIVE");
  });

  it("also matches by the professional account id", async () => {
    const res = await deauthorizeRoute.POST(
      form("/api/instagram/deauthorize", signed({ algorithm: "HMAC-SHA256", user_id: IG_ID_B }))
    );
    expect((await res.json()).result).toBe("disconnected");
    expect(await count("Automation", `id = 'auto_b'`)).toBe(1);
  });

  it("bad signature: 400 and nothing changes", async () => {
    const res = await deauthorizeRoute.POST(
      form("/api/instagram/deauthorize", signed({ algorithm: "HMAC-SHA256", user_id: APP_SCOPED_A }, "wrong"))
    );
    expect(res.status).toBe(400);
    expect(await count("InstagramAccount", `status = 'ACTIVE'`)).toBe(2);
  });

  it("unknown user: 200, nothing changes", async () => {
    const res = await deauthorizeRoute.POST(
      form("/api/instagram/deauthorize", signed({ algorithm: "HMAC-SHA256", user_id: "123" }))
    );
    expect(res.status).toBe(200);
    expect((await res.json()).result).toBe("not_found");
    expect(await count("InstagramAccount", `status = 'ACTIVE'`)).toBe(2);
  });
});

describe("POST /api/instagram/data-deletion", () => {
  it("deletes everything of the right account (raw webhooks too) and returns url + confirmation_code", async () => {
    const res = await deletionRoute.POST(
      form("/api/instagram/data-deletion", signed({ algorithm: "HMAC-SHA256", user_id: APP_SCOPED_A }))
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.confirmation_code).toMatch(/^[A-F0-9]{20}$/);
    expect(body.url).toBe(`https://many.leadenginer.com/data-deletion/status?code=${body.confirmation_code}`);
    expect(h.unsubscribe).toHaveBeenCalledWith(IG_ID_A, "plain:enc-a");

    expect(await count("InstagramAccount", `id = 'acc_a'`)).toBe(0);
    expect(await count("Automation", `id = 'auto_a'`)).toBe(0);
    expect(await count("Contact", `id = 'ct_a'`)).toBe(0);
    expect(await count("DirectMessage", `id = 'dm_a'`)).toBe(0);
    expect(await count("WebhookEvent", `id = 'wh_a'`)).toBe(0);
    // a payload without an entry array never breaks the delete (and is not touched)
    expect(await count("WebhookEvent", `id = 'wh_odd'`)).toBe(1);
    // the other account keeps everything
    expect(await count("InstagramAccount", `id = 'acc_b'`)).toBe(1);
    expect(await count("Automation", `id = 'auto_b'`)).toBe(1);
    expect(await count("Contact", `id = 'ct_b'`)).toBe(1);
    expect(await count("DirectMessage", `id = 'dm_b'`)).toBe(1);
    expect(await count("WebhookEvent", `id = 'wh_b'`)).toBe(1);

    const status = await getDeletionStatus(body.confirmation_code.toLowerCase());
    expect(status?.status).toBe("COMPLETED");
    expect(status?.completedAt).toBeInstanceOf(Date);
    // the public lookup only exposes status and dates
    expect(Object.keys(status ?? {}).sort()).toEqual(["completedAt", "createdAt", "status"]);
  });

  it("no account with that id: request recorded as NOT_FOUND, nothing deleted", async () => {
    const res = await deletionRoute.POST(
      form("/api/instagram/data-deletion", signed({ algorithm: "HMAC-SHA256", user_id: "555" }))
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect((await getDeletionStatus(body.confirmation_code))?.status).toBe("NOT_FOUND");
    expect(await count("InstagramAccount")).toBe(2);
    expect(await count("Contact")).toBe(2);
    expect(await count("WebhookEvent")).toBe(3);
  });

  it("more than one account matches: AMBIGUOUS, nothing deleted", async () => {
    await db.exec(`UPDATE "InstagramAccount" SET "appScopedId" = '${IG_ID_A}' WHERE id = 'acc_b'`);
    const res = await deletionRoute.POST(
      form("/api/instagram/data-deletion", signed({ algorithm: "HMAC-SHA256", user_id: IG_ID_A }))
    );
    const body = await res.json();
    expect((await getDeletionStatus(body.confirmation_code))?.status).toBe("AMBIGUOUS");
    expect(await count("InstagramAccount")).toBe(2);
  });

  it("bad signature, wrong algorithm or missing field: 400, nothing deleted, nothing recorded", async () => {
    for (const sr of [
      signed({ algorithm: "HMAC-SHA256", user_id: APP_SCOPED_A }, "wrong"),
      signed({ algorithm: "RSA", user_id: APP_SCOPED_A }),
      "garbage",
      null,
    ]) {
      const res = await deletionRoute.POST(form("/api/instagram/data-deletion", sr));
      expect(res.status).toBe(400);
    }
    expect(await count("InstagramAccount")).toBe(2);
    expect(await count("DataDeletionRequest")).toBe(0);
  });

  it("RLS: the app role (a normal user) never reads or writes deletion requests", async () => {
    await deletionRoute.POST(
      form("/api/instagram/data-deletion", signed({ algorithm: "HMAC-SHA256", user_id: "555" }))
    );
    expect(await count("DataDeletionRequest")).toBe(1);
    const rows = await withRls({ userId: "u_a", workspaceId: "ws_a" }, (tx) => tx.dataDeletionRequest.findMany(), h.prisma);
    expect(rows).toEqual([]);
    await expect(
      withRls(
        { userId: "u_a", workspaceId: "ws_a" },
        (tx) => tx.dataDeletionRequest.create({ data: { confirmationCode: "X", metaUserId: "1" } }),
        h.prisma
      )
    ).rejects.toThrow();
  });

  it("unknown or malformed code on the status lookup: null", async () => {
    expect(await getDeletionStatus("ABCDEF0123456789ABCD")).toBeNull();
    expect(await getDeletionStatus("'; DROP TABLE x; --")).toBeNull();
  });
});
