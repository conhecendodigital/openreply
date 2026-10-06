/**
 * WhatsApp: webhook (assinatura, replay, idempotência, limites) e ingestão.
 */
import { describe, expect, it } from "vitest";
import { isApiKeyRouteAllowed } from "@/lib/api-key-routes";
import { processIngestJob } from "@/lib/whatsapp/ingest";
import { signBody, verifyAnySecret, verifyHmacSignature } from "@/lib/whatsapp/signature";
import { handleWhatsAppWebhook, MAX_WA_WEBHOOK_BYTES, OPENWA_MAX_EVENT_AGE_MS, readBodyLimited, type WebhookDeps } from "@/lib/whatsapp/webhook";
import { getWhatsAppRuntime } from "@/lib/whatsapp/runtime";
import { META_SECRET, NOW, OPENWA_SECRET, setup } from "./wa-helpers";

function openwaBody(overrides: Record<string, unknown> = {}, data: Record<string, unknown> = {}) {
  return JSON.stringify({
    event: "message.received",
    timestamp: new Date(NOW - 2_000).toISOString(),
    sessionId: "owa-1",
    idempotencyKey: "idem-abc",
    deliveryId: "dlv-1",
    data: {
      id: "true_5511988887777@c.us_3EB0AA",
      from: "5511988887777@c.us",
      to: "5511900000000@c.us",
      chatId: "5511988887777@c.us",
      body: "Oi, vocês atendem sábado?",
      type: "text",
      timestamp: Math.floor((NOW - 3_000) / 1000),
      fromMe: false,
      isGroup: false,
      contact: { pushName: "Joana" },
      ...data,
    },
    ...overrides,
  });
}

function headersFor(body: string, kind: "openwa" | "meta", secret: string, extra: Record<string, string> = {}) {
  const h = new Headers({ "content-type": "application/json", ...extra });
  h.set(kind === "openwa" ? "x-openwa-signature" : "x-hub-signature-256", signBody(body, secret));
  return h;
}

function metaBody(field: string, value: Record<string, unknown>) {
  return JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "waba-1", changes: [{ field, value: { messaging_product: "whatsapp", metadata: { phone_number_id: "pn-1", display_phone_number: "5511900000000" }, ...value } }] }],
  });
}

function deps(ctx: ReturnType<typeof setup>, extra: Partial<WebhookDeps> = {}): WebhookDeps {
  const counts = new Map<string, number>();
  return {
    repo: ctx.repo,
    queue: ctx.queue,
    metaAppSecrets: [META_SECRET],
    now: () => NOW,
    rateLimitStore: {
      async incr(key: string) {
        const n = (counts.get(key) ?? 0) + 1;
        counts.set(key, n);
        return n;
      },
      async expire() {
        return 1;
      },
    },
    ...extra,
  };
}

describe("assinatura HMAC", () => {
  it("aceita a assinatura certa e recusa errada, adulterada, malformada e sem segredo", () => {
    const body = '{"a":1}';
    expect(verifyHmacSignature(body, signBody(body, "s"), "s")).toBe(true);
    expect(verifyHmacSignature(body, signBody(body, "outro"), "s")).toBe(false);
    expect(verifyHmacSignature('{"a":2}', signBody(body, "s"), "s")).toBe(false);
    expect(verifyHmacSignature(body, "sha256=curta", "s")).toBe(false);
    expect(verifyHmacSignature(body, null, "s")).toBe(false);
    expect(verifyHmacSignature(body, signBody(body, "s"), null)).toBe(false);
    expect(verifyHmacSignature(body, signBody(body, "s").toUpperCase().replace("SHA256=", "sha256="), "s")).toBe(true);
  });

  it("rotação: confere qualquer um dos segredos do app", () => {
    const body = "{}";
    expect(verifyAnySecret(body, signBody(body, "novo"), ["velho", "novo"])).toBe(true);
    expect(verifyAnySecret(body, signBody(body, "x"), ["velho", undefined])).toBe(false);
  });
});

describe("webhook OpenWA", () => {
  it("assinatura válida: normaliza e põe na fila wa-ingest", async () => {
    const ctx = setup();
    const body = openwaBody();
    const res = await handleWhatsAppWebhook({ headers: headersFor(body, "openwa", OPENWA_SECRET), rawBody: body, ip: "1.1.1.1" }, deps(ctx));
    expect(res.status).toBe(200);
    expect(ctx.queue.ingest).toHaveLength(1);
    const job = ctx.queue.ingest[0];
    expect(job.ownerUserId).toBe("user_a");
    expect(job.sessionId).toBe("sess_1");
    expect(job.event).toMatchObject({
      kind: "message",
      provider: "OPENWA",
      chatJid: "5511988887777@c.us",
      phoneE164: "+5511988887777",
      pushName: "Joana",
      sentBy: "CONTACT",
      body: "Oi, vocês atendem sábado?",
    });
  });

  it("assinatura inválida: 401 e não grava nada", async () => {
    const ctx = setup();
    const body = openwaBody();
    const res = await handleWhatsAppWebhook({ headers: headersFor(body, "openwa", "segredo-errado"), rawBody: body, ip: "1.1.1.1" }, deps(ctx));
    expect(res.status).toBe(401);
    expect(ctx.repo.webhookEvents.size).toBe(0);
    expect(ctx.queue.ingest).toHaveLength(0);
  });

  it("corpo adulterado depois de assinado: 401", async () => {
    const ctx = setup();
    const body = openwaBody();
    const headers = headersFor(body, "openwa", OPENWA_SECRET);
    const tampered = body.replace("sábado", "domingo");
    const res = await handleWhatsAppWebhook({ headers, rawBody: tampered, ip: "1.1.1.1" }, deps(ctx));
    expect(res.status).toBe(401);
  });

  it("sessão desconhecida responde igual a assinatura errada", async () => {
    const ctx = setup();
    const body = openwaBody({ sessionId: "nao-existe" });
    const res = await handleWhatsAppWebhook({ headers: headersFor(body, "openwa", OPENWA_SECRET), rawBody: body, ip: "1.1.1.1" }, deps(ctx));
    expect(res.status).toBe(401);
  });

  it("replay do mesmo corpo assinado: 200 sem enfileirar de novo", async () => {
    const ctx = setup();
    const d = deps(ctx);
    const body = openwaBody();
    const first = await handleWhatsAppWebhook({ headers: headersFor(body, "openwa", OPENWA_SECRET), rawBody: body, ip: "1.1.1.1" }, d);
    // Reenvio com outro Idempotency-Key no cabeçalho (não assinado): continua duplicado.
    const again = await handleWhatsAppWebhook(
      { headers: headersFor(body, "openwa", OPENWA_SECRET, { "x-openwa-idempotency-key": "outra" }), rawBody: body, ip: "2.2.2.2" },
      d
    );
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(1);
    expect(ctx.queue.ingest).toHaveLength(1);
  });

  it("replay antigo (fora da janela de tempo): 401", async () => {
    const ctx = setup();
    const body = openwaBody({ timestamp: new Date(NOW - OPENWA_MAX_EVENT_AGE_MS - 1000).toISOString() });
    const res = await handleWhatsAppWebhook({ headers: headersFor(body, "openwa", OPENWA_SECRET), rawBody: body, ip: "1.1.1.1" }, deps(ctx));
    expect(res.status).toBe(401);
    expect(ctx.queue.ingest).toHaveLength(0);
  });

  it("timestamp no futuro além da tolerância: 401", async () => {
    const ctx = setup();
    const body = openwaBody({ timestamp: new Date(NOW + 60 * 60 * 1000).toISOString() });
    const res = await handleWhatsAppWebhook({ headers: headersFor(body, "openwa", OPENWA_SECRET), rawBody: body, ip: "1.1.1.1" }, deps(ctx));
    expect(res.status).toBe(401);
  });

  it("fila caiu: 500 pro provedor reentregar, e a reentrega enfileira", async () => {
    const ctx = setup();
    const d = deps(ctx);
    const body = openwaBody();
    ctx.queue.failNextIngest = true;
    await expect(
      handleWhatsAppWebhook({ headers: headersFor(body, "openwa", OPENWA_SECRET), rawBody: body, ip: "1.1.1.1" }, d)
    ).rejects.toThrow();
    const retry = await handleWhatsAppWebhook({ headers: headersFor(body, "openwa", OPENWA_SECRET), rawBody: body, ip: "1.1.1.1" }, d);
    expect(retry.status).toBe(200);
    expect(ctx.queue.ingest).toHaveLength(1);
  });

  it("sem cabeçalho de assinatura: 401", async () => {
    const ctx = setup();
    const body = openwaBody();
    const res = await handleWhatsAppWebhook({ headers: new Headers(), rawBody: body, ip: "1.1.1.1" }, deps(ctx));
    expect(res.status).toBe(401);
  });

  it("corpo acima do limite: 413", async () => {
    const ctx = setup();
    const big = "x".repeat(MAX_WA_WEBHOOK_BYTES + 1);
    const res = await handleWhatsAppWebhook({ headers: headersFor(big, "openwa", OPENWA_SECRET), rawBody: big, ip: "1.1.1.1" }, deps(ctx));
    expect(res.status).toBe(413);
    const declared = await handleWhatsAppWebhook(
      { headers: new Headers({ "content-length": String(MAX_WA_WEBHOOK_BYTES + 10) }), rawBody: "{}", ip: "1.1.1.1" },
      deps(ctx)
    );
    expect(declared.status).toBe(413);
  });

  it("leitura do corpo para no limite", async () => {
    const stream = new Blob(["a".repeat(50)]).stream();
    expect(await readBodyLimited(stream, 10)).toBeNull();
    expect(await readBodyLimited(new Blob(["abc"]).stream(), 10)).toBe("abc");
  });

  it("limite por IP: 429 depois do teto", async () => {
    const ctx = setup();
    const d = deps(ctx);
    let last = 0;
    for (let i = 0; i < 601; i++) {
      const r = await handleWhatsAppWebhook({ headers: new Headers(), rawBody: "{}", ip: "9.9.9.9" }, d);
      last = r.status;
    }
    expect(last).toBe(429);
    const other = await handleWhatsAppWebhook({ headers: new Headers(), rawBody: "{}", ip: "8.8.8.8" }, d);
    expect(other.status).toBe(401);
  });

  it("session.qr vira evento de sessão com o QR", async () => {
    const ctx = setup();
    const body = JSON.stringify({
      event: "session.qr",
      timestamp: new Date(NOW).toISOString(),
      sessionId: "owa-1",
      idempotencyKey: "qr-1",
      deliveryId: "d",
      data: { sessionId: "owa-1", qr: "data:image/png;base64,AAA" },
    });
    await handleWhatsAppWebhook({ headers: headersFor(body, "openwa", OPENWA_SECRET), rawBody: body, ip: "1.1.1.1" }, deps(ctx));
    expect(ctx.queue.ingest[0].event).toMatchObject({ kind: "session", status: "QR_READY", qr: "data:image/png;base64,AAA" });
  });

  it("session.status { status: ready } (evento real do OpenWA) vira CONNECTED", async () => {
    const ctx = setup();
    const body = JSON.stringify({
      event: "session.status",
      timestamp: new Date(NOW).toISOString(),
      sessionId: "owa-1",
      idempotencyKey: "st-1",
      deliveryId: "d",
      data: { sessionId: "owa-1", status: "ready" },
    });
    await handleWhatsAppWebhook({ headers: headersFor(body, "openwa", OPENWA_SECRET), rawBody: body, ip: "1.1.1.1" }, deps(ctx));
    expect(ctx.queue.ingest[0].event).toMatchObject({ kind: "session", status: "CONNECTED" });
  });

  it("só assina eventos que o OpenWA aceita no POST /webhooks", async () => {
    const { OPENWA_WEBHOOK_EVENTS } = await import("@/lib/whatsapp/openwa");
    // Lista de WEBHOOK_EVENTS do OpenWA 0.24 (src/modules/webhook/dto/webhook.dto.ts).
    const aceitos = new Set([
      "message.received", "message.sent", "message.ack", "message.failed", "message.revoked", "message.reaction",
      "message.edited", "status.received", "session.status", "session.qr", "session.authenticated",
      "session.disconnected", "session.reconnect_loop", "session.restriction",
    ]);
    for (const e of OPENWA_WEBHOOK_EVENTS) expect(aceitos.has(e)).toBe(true);
  });
});

describe("webhook Meta (Cloud API + coexistência)", () => {
  const cloud = () => setup({ id: "sess_c", provider: "CLOUD_API", providerSessionId: "pn-1", webhookSecret: null });

  it("assinatura válida: mensagem recebida e status entram na fila", async () => {
    const ctx = cloud();
    const body = metaBody("messages", {
      contacts: [{ wa_id: "5511977776666", profile: { name: "Carlos" } }],
      messages: [{ id: "wamid.IN1", from: "5511977776666", timestamp: String(Math.floor(NOW / 1000)), type: "text", text: { body: "Tem horário amanhã?" } }],
      statuses: [{ id: "wamid.OUT1", status: "read", timestamp: String(Math.floor(NOW / 1000)), recipient_id: "5511977776666" }],
    });
    const res = await handleWhatsAppWebhook({ headers: headersFor(body, "meta", META_SECRET), rawBody: body, ip: "3.3.3.3" }, deps(ctx));
    expect(res.status).toBe(200);
    expect(res.body.queued).toBe(2);
    expect(ctx.queue.ingest.map((j) => j.event.kind)).toEqual(["message", "ack"]);
    expect(ctx.queue.ingest[0].event).toMatchObject({
      provider: "CLOUD_API",
      chatJid: "5511977776666@s.whatsapp.net",
      pushName: "Carlos",
      sentBy: "CONTACT",
      body: "Tem horário amanhã?",
    });
  });

  it("eco do celular (smb_message_echoes) vira USER_PHONE", async () => {
    const ctx = cloud();
    const body = metaBody("smb_message_echoes", {
      message_echoes: [{ id: "wamid.ECHO", from: "5511900000000", to: "5511977776666", timestamp: String(Math.floor(NOW / 1000)), type: "text", text: { body: "Tem sim" } }],
    });
    await handleWhatsAppWebhook({ headers: headersFor(body, "meta", META_SECRET), rawBody: body, ip: "3.3.3.3" }, deps(ctx));
    expect(ctx.queue.ingest[0].event).toMatchObject({ fromMe: true, sentBy: "USER_PHONE", chatJid: "5511977776666@s.whatsapp.net" });
  });

  it("assinatura inválida: 401 e nada gravado", async () => {
    const ctx = cloud();
    const body = metaBody("messages", { messages: [{ id: "wamid.X", from: "5511977776666", type: "text", text: { body: "oi" } }] });
    const res = await handleWhatsAppWebhook({ headers: headersFor(body, "meta", "outro-app"), rawBody: body, ip: "3.3.3.3" }, deps(ctx));
    expect(res.status).toBe(401);
    expect(ctx.repo.webhookEvents.size).toBe(0);
  });

  it("reentrega da Meta não duplica", async () => {
    const ctx = cloud();
    const d = deps(ctx);
    const body = metaBody("messages", { messages: [{ id: "wamid.R", from: "5511977776666", type: "text", text: { body: "oi" } }] });
    await handleWhatsAppWebhook({ headers: headersFor(body, "meta", META_SECRET), rawBody: body, ip: "3.3.3.3" }, d);
    const again = await handleWhatsAppWebhook({ headers: headersFor(body, "meta", META_SECRET), rawBody: body, ip: "3.3.3.3" }, d);
    expect(again.body.duplicate).toBe(1);
    expect(ctx.queue.ingest).toHaveLength(1);
  });

  it("número que não é de ninguém é ignorado com 200", async () => {
    const ctx = setup(); // só tem sessão OpenWA
    const body = metaBody("messages", { messages: [{ id: "wamid.N", from: "5511977776666", type: "text", text: { body: "oi" } }] });
    const res = await handleWhatsAppWebhook({ headers: headersFor(body, "meta", META_SECRET), rawBody: body, ip: "3.3.3.3" }, deps(ctx));
    expect(res.status).toBe(200);
    expect(res.body.unknownNumber).toBe(1);
    expect(ctx.queue.ingest).toHaveLength(0);
  });

  it("sem segredo do app configurado: 503", async () => {
    const ctx = cloud();
    const body = metaBody("messages", {});
    const res = await handleWhatsAppWebhook(
      { headers: headersFor(body, "meta", META_SECRET), rawBody: body, ip: "3.3.3.3" },
      deps(ctx, { metaAppSecrets: [undefined] })
    );
    expect(res.status).toBe(503);
  });
});

describe("rota e travas", () => {
  it("chave de API não chega no webhook (fora de lib/api-key-routes.ts)", () => {
    expect(isApiKeyRouteAllowed("POST", "/api/whatsapp/webhook")).toBe(false);
    expect(isApiKeyRouteAllowed("GET", "/api/whatsapp/webhook")).toBe(false);
  });

  it("sem WHATSAPP_ENABLED=1 o runtime fica desligado", () => {
    expect(getWhatsAppRuntime({})).toBeNull();
  });
});

describe("ingestão (wa-ingest)", () => {
  it("grava contato, conversa e mensagem; job repetido não duplica", async () => {
    const ctx = setup();
    const body = openwaBody();
    await handleWhatsAppWebhook({ headers: headersFor(body, "openwa", OPENWA_SECRET), rawBody: body, ip: "1.1.1.1" }, deps(ctx));
    const job = ctx.queue.ingest[0];
    const inbound: string[] = [];
    const ingestDeps = { repo: ctx.repo, onInboundMessage: async (i: { messageId: string }) => void inbound.push(i.messageId) };
    const a = await processIngestJob(job, ingestDeps);
    const b = await processIngestJob(job, ingestDeps);
    expect(a).toMatchObject({ kind: "message", created: true });
    expect(b).toMatchObject({ kind: "message", created: false });
    expect(ctx.repo.messages.size).toBe(1);
    expect(ctx.repo.contacts.size).toBe(1);
    expect(inbound).toHaveLength(1);
    const conv = [...ctx.repo.conversations.values()][0];
    expect(conv.unreadCount).toBe(1);
    expect(conv.lastMessagePreview).toBe("Oi, vocês atendem sábado?");
  });

  it("eco do celular avisa onOwnerMessage; eco que chega antes do envio do agente é corrigido pra AGENT", async () => {
    const ctx = setup();
    const owner: string[] = [];
    const eco = openwaBody({ event: "message.sent", idempotencyKey: "eco-1" }, { id: "out-77", fromMe: true, body: "Oi, Joana!" });
    await handleWhatsAppWebhook({ headers: headersFor(eco, "openwa", OPENWA_SECRET), rawBody: eco, ip: "1.1.1.1" }, deps(ctx));
    const res = await processIngestJob(ctx.queue.ingest[0], {
      repo: ctx.repo,
      onOwnerMessage: async (i: { messageId: string }) => void owner.push(i.messageId),
    });
    expect(res).toMatchObject({ kind: "message", created: true });
    expect(owner).toHaveLength(1);
    const msg = [...ctx.repo.messages.values()].find((m) => m.providerMessageId === "out-77")!;
    expect(msg.sentBy).toBe("USER_PHONE");
    // O envio do agente grava depois com o mesmo id: a linha passa a ser do agente.
    await ctx.repo.insertMessage({ ...msg, sentBy: "AGENT", agentRunId: "run_9" });
    expect(msg.sentBy).toBe("AGENT");
    expect(msg.agentRunId).toBe("run_9");
    // E o contrário não acontece: eco atrasado não rebaixa AGENT pra USER_PHONE.
    await ctx.repo.insertMessage({ ...msg, sentBy: "USER_PHONE", agentRunId: null });
    expect(msg.sentBy).toBe("AGENT");
  });

  it("ack nunca volta (read não vira delivered)", async () => {
    const ctx = setup();
    const { conversation } = await (await import("./wa-helpers")).seedConversation(ctx.repo, ctx.session, 1000);
    await ctx.repo.insertMessage({
      ownerUserId: "user_a",
      conversationId: conversation.id,
      sessionId: "sess_1",
      providerMessageId: "out-1",
      fromMe: true,
      sentBy: "AGENT",
      type: "text",
      body: "ok",
      quotedId: null,
      ack: "sent",
      agentRunId: null,
      sentAt: new Date(NOW),
    });
    const ack = (a: "read" | "delivered") => ({
      dedupeKey: `k-${a}`,
      sessionId: "sess_1",
      ownerUserId: "user_a",
      event: { kind: "ack" as const, provider: "OPENWA" as const, providerSessionId: "owa-1", providerMessageId: "out-1", ack: a, timestamp: NOW },
    });
    await processIngestJob(ack("read"), { repo: ctx.repo });
    await processIngestJob(ack("delivered"), { repo: ctx.repo });
    const msg = [...ctx.repo.messages.values()].find((m) => m.providerMessageId === "out-1");
    expect(msg?.ack).toBe("read");
  });

  it("job de outro dono é ignorado", async () => {
    const ctx = setup();
    const res = await processIngestJob(
      {
        dedupeKey: "x",
        sessionId: "sess_1",
        ownerUserId: "user_b",
        event: { kind: "ack", provider: "OPENWA", providerSessionId: "owa-1", providerMessageId: "m", ack: "read", timestamp: NOW },
      },
      { repo: ctx.repo }
    );
    expect(res).toEqual({ kind: "skipped", reason: "sessao_inexistente" });
  });
});
