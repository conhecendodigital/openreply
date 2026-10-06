/**
 * uazapi (06/10/2026): conector, webhook e envio contra um servidor uazapi
 * FALSO (HTTP de verdade em 127.0.0.1). Nada chama a uazapi real.
 */
import { UnrecoverableError } from "bullmq";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WhatsAppConnectorError } from "@/lib/whatsapp/connector";
import { createConnector } from "@/lib/whatsapp/factory";
import { processIngestJob } from "@/lib/whatsapp/ingest";
import { processSendJob } from "@/lib/whatsapp/outbound";
import { InMemorySendRateLimiter } from "@/lib/whatsapp/pacing";
import { uazapiCredentialsFor } from "@/lib/whatsapp/runtime";
import { uazapiWebhookUrl, whatsappStatus } from "@/lib/whatsapp/setup";
import {
  listProxyCities,
  listProxyCountries,
  mapUazapiStatus,
  toUazapiNumber,
  UazapiAdmin,
  UazapiConnector,
  uazapiFromEnv,
  UAZAPI_WEBHOOK_EVENTS,
} from "@/lib/whatsapp/uazapi";
import { handleUazapiWebhook, mapUazapiType, normalizeUazapi, sameSecret } from "@/lib/whatsapp/uazapi-webhook";
import { sendErrorForQueue } from "@/lib/whatsapp/worker";
import { FAKE_ADMIN_TOKEN, FakeUazapi } from "./helpers/fake-uazapi";
import { NOW, seedConversation, setup } from "./wa-helpers";

const fake = new FakeUazapi();
const REGION = { country: "br", state: "sp", city: "campinas" };
const URL_SECRET = "u".repeat(43);

beforeAll(async () => {
  await fake.start();
});
afterAll(async () => {
  await fake.stop();
});
beforeEach(() => fake.reset());

async function newInstance() {
  const admin = new UazapiAdmin({ serverUrl: fake.url, adminToken: FAKE_ADMIN_TOKEN });
  const created = await admin.createInstance("le-teste", REGION);
  return { created, connector: new UazapiConnector({ serverUrl: fake.url, instanceToken: created.token }) };
}

describe("variáveis de ambiente", () => {
  it("sem UAZAPI_SERVER_URL e UAZAPI_ADMIN_TOKEN a uazapi fica desligada e nada quebra", () => {
    expect(uazapiFromEnv({})).toBeNull();
    expect(uazapiFromEnv({ UAZAPI_SERVER_URL: "https://x.uazapi.com" })).toBeNull();
    expect(uazapiFromEnv({ UAZAPI_ADMIN_TOKEN: "a" })).toBeNull();
    expect(whatsappStatus({ WHATSAPP_ENABLED: "1" })).toMatchObject({ uazapiConfigured: false });
    expect(uazapiCredentialsFor({ provider: "UAZAPI", instanceToken: "t" }, {})).toBeUndefined();
  });

  it("limite de instâncias: padrão 2, configurável por UAZAPI_MAX_INSTANCES", () => {
    const base = { UAZAPI_SERVER_URL: "https://x.uazapi.com/", UAZAPI_ADMIN_TOKEN: "a" };
    expect(uazapiFromEnv(base)).toEqual({ serverUrl: "https://x.uazapi.com", adminToken: "a", maxInstances: 2 });
    expect(uazapiFromEnv({ ...base, UAZAPI_MAX_INSTANCES: "5" })?.maxInstances).toBe(5);
    expect(uazapiFromEnv({ ...base, UAZAPI_MAX_INSTANCES: "abc" })?.maxInstances).toBe(2);
    expect(whatsappStatus({ ...base, WHATSAPP_ENABLED: "1" })).toMatchObject({ uazapiConfigured: true });
  });

  it("URL do webhook do número leva o id e o segredo, só por https", () => {
    expect(uazapiWebhookUrl("sess_1", URL_SECRET, { BETTER_AUTH_URL: "https://app.exemplo.com" })).toBe(
      `https://app.exemplo.com/api/whatsapp/webhook/uazapi/sess_1/${URL_SECRET}`
    );
    expect(uazapiWebhookUrl("sess_1", URL_SECRET, { BETTER_AUTH_URL: "http://localhost:3000" })).toBeNull();
  });
});

describe("conector uazapi (servidor falso)", () => {
  it("lista países e cidades do proxy gerenciado", async () => {
    expect(await listProxyCountries(fake.url)).toEqual([
      { value: "br", label: "Brazil" },
      { value: "pt", label: "Portugal" },
    ]);
    const cities = await listProxyCities(fake.url, "br", "camp");
    expect(cities).toEqual([{ value: "campinas", label: "Campinas", state: "sp", stateLabel: "São Paulo" }]);
  });

  it("cria a instância com admintoken e a região do proxy; o token volta pra ser guardado", async () => {
    const { created } = await newInstance();
    expect(created.instanceId).toBe("r1abc");
    expect(created.token).toMatch(/^tok-/);
    const call = fake.calls.find((c) => c.path === "/instance/create")!;
    expect(call.headers.admintoken).toBe(FAKE_ADMIN_TOKEN);
    expect(call.headers.token).toBeUndefined();
    expect(call.body).toMatchObject({ proxy_managed_country: "br", proxy_managed_state: "sp", proxy_managed_city: "campinas" });
  });

  it("admintoken errado: erro 401 sem vazar a chave", async () => {
    const admin = new UazapiAdmin({ serverUrl: fake.url, adminToken: "errado" });
    const err = await admin.createInstance("x", REGION).catch((e) => e);
    expect(err).toBeInstanceOf(WhatsAppConnectorError);
    expect(err.status).toBe(401);
    expect(String(err.message)).not.toContain("errado");
  });

  it("conecta por QR (sem phone) e manda a região de novo", async () => {
    const { connector } = await newInstance();
    const out = await connector.connect({ region: REGION });
    expect(out.status).toBe("QR_READY");
    expect(out.qr).toMatch(/^data:image\/png;base64,/);
    expect(out.pairCode).toBeNull();
    const call = fake.calls.find((c) => c.path === "/instance/connect")!;
    expect(call.body).toEqual({ proxy_managed_country: "br", proxy_managed_state: "sp", proxy_managed_city: "campinas" });
  });

  it("conecta por código de pareamento quando recebe o número", async () => {
    const { connector } = await newInstance();
    const out = await connector.connect({ phone: "+55 (11) 91234-5678", region: REGION });
    expect(out).toMatchObject({ status: "QR_READY", qr: null, pairCode: "ABCD-1234" });
    expect(fake.calls.find((c) => c.path === "/instance/connect")!.body).toMatchObject({ phone: "5511912345678" });
    await expect(connector.connect({ phone: "123" })).rejects.toThrow(/inválido/);
  });

  it("status: conectado com número e nome do perfil", async () => {
    const { created, connector } = await newInstance();
    await connector.connect({ region: REGION });
    fake.pair(created.instanceId, "5511912345678", "Loja Teste");
    expect(await connector.getInfo()).toMatchObject({ status: "CONNECTED", phoneE164: "+5511912345678", pushName: "Loja Teste", qr: null });
    expect(mapUazapiStatus("hibernated")).toBe("DISCONNECTED");
    expect(mapUazapiStatus("disconnected", false, "TemporaryBan")).toBe("RESTRICTED");
  });

  it("desconectar faz logout e NUNCA apaga a instância", async () => {
    const { connector } = await newInstance();
    await connector.disconnect();
    expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toContain("POST /instance/disconnect");
    expect(fake.calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(fake.instances).toHaveLength(1);
  });

  it("reiniciar usa /instance/reset (sem novo pareamento)", async () => {
    const { connector } = await newInstance();
    expect(await connector.reset()).toEqual({ resetting: true, message: "Instance reset started" });
  });

  it("webhook: só https, eventos sem 'history' e sem o eco do que a API enviou", async () => {
    const { connector } = await newInstance();
    await expect(connector.ensureWebhook("http://inseguro.com/x")).rejects.toThrow(/HTTPS/);
    await connector.ensureWebhook(`https://app.exemplo.com/api/whatsapp/webhook/uazapi/s1/${URL_SECRET}`);
    const wh = fake.instances[0].webhook!;
    expect(wh.events).toEqual(["messages", "messages_update", "connection"]);
    expect(wh.events).not.toContain("history");
    expect(UAZAPI_WEBHOOK_EVENTS).not.toContain("history");
    expect(wh.excludeMessages).toEqual(["wasSentByApi"]);
    expect(wh.addUrlEvents).toBe(false);
  });

  it("envia texto e mídia com o token da instância; o id volta pro Lead Engine", async () => {
    const { created, connector } = await newInstance();
    fake.pair(created.instanceId);
    const text = await connector.sendText("5511988887777@c.us", "Oi!", { idempotencyKey: "out_1:0", quotedProviderMessageId: "3EB0IN" });
    expect(text.providerMessageId).toMatch(/^3EB0/);
    const call = fake.calls.find((c) => c.path === "/send/text")!;
    expect(call.headers.token).toBe(created.token);
    expect(call.body).toEqual({ number: "5511988887777", text: "Oi!", replyid: "3EB0IN", track_source: "lead-engine", track_id: "out_1:0" });

    const media = await connector.sendMedia("5511988887777@s.whatsapp.net", {
      mediaType: "document",
      url: "https://cdn.exemplo.com/a.pdf",
      filename: "orcamento.pdf",
      caption: "Segue",
      mime: "application/pdf",
    });
    expect(media.providerMessageId).toMatch(/^3EB0/);
    expect(fake.calls.find((c) => c.path === "/send/media")!.body).toMatchObject({
      number: "5511988887777",
      type: "document",
      file: "https://cdn.exemplo.com/a.pdf",
      text: "Segue",
      docName: "orcamento.pdf",
    });
    await expect(connector.sendTemplate("1", { name: "x", language: "pt_BR" })).rejects.toThrow(/Cloud API/);
  });

  it("digitando e marcar como lido", async () => {
    const { connector } = await newInstance();
    await connector.setTyping("5511988887777@c.us", true);
    await connector.setTyping("5511988887777@c.us", false);
    await connector.markRead("5511988887777@c.us", ["3EB0A", "3EB0B"]);
    await connector.markRead("5511988887777@c.us", []);
    const relevant = fake.calls.filter((c) => c.path.startsWith("/message/") || c.path.startsWith("/chat/"));
    expect(relevant.map((c) => [c.path, c.body])).toEqual([
      ["/message/presence", { number: "5511988887777", presence: "composing" }],
      ["/message/presence", { number: "5511988887777", presence: "paused" }],
      ["/message/markread", { id: ["3EB0A", "3EB0B"] }],
      ["/chat/read", { number: "5511988887777@s.whatsapp.net", read: true }],
    ]);
    expect(toUazapiNumber("120363@g.us")).toBe("120363@g.us");
  });

  it("mídia recebida: pede o fileURL e baixa no servidor", async () => {
    const { connector } = await newInstance();
    const media = await connector.fetchMedia("5511988887777@s.whatsapp.net", "3EB0IMG");
    expect(media?.contentType).toBe("image/jpeg");
    expect(Array.from(media!.bytes.slice(0, 2))).toEqual([0xff, 0xd8]);
  });

  it("envio com 5xx ou tempo esgotado não é repetido (a uazapi não tem idempotência)", async () => {
    const { connector } = await newInstance();
    fake.failNextSend = true;
    const err = await connector.sendText("5511988887777", "oi").catch((e) => e);
    expect(err).toBeInstanceOf(WhatsAppConnectorError);
    expect(err.retryable).toBe(false);
    expect(sendErrorForQueue(err)).toBeInstanceOf(UnrecoverableError);
    // OpenWA continua igual: o erro passa como veio.
    const owa = new WhatsAppConnectorError("x", "OPENWA", 500, false);
    expect(sendErrorForQueue(owa)).toBe(owa);
    // Leitura com 5xx pode repetir.
    expect(new WhatsAppConnectorError("x", "UAZAPI", 503, true).retryable).toBe(true);
  });

  it("fábrica: provider UAZAPI usa o token do número", () => {
    const c = createConnector({ provider: "UAZAPI", providerSessionId: "r1", riskAcceptedAt: null }, { credentials: { uazapi: { serverUrl: fake.url, instanceToken: "t" } } });
    expect(c.provider).toBe("UAZAPI");
    expect(() => createConnector({ provider: "UAZAPI", providerSessionId: "r1", riskAcceptedAt: null }, { credentials: {} })).toThrow(/uazapi/);
  });
});

describe("eventos da uazapi normalizados", () => {
  const base = { owner: "5511912345678", token: "tok", BaseUrl: "https://x", instanceName: "le" };

  it("mensagem de texto recebida", () => {
    const [m] = normalizeUazapi(
      {
        ...base,
        EventType: "messages",
        message: {
          id: "5511912345678:3EB0AA",
          messageid: "3EB0AA",
          chatid: "5511988887777@s.whatsapp.net",
          sender: "5511988887777@s.whatsapp.net",
          senderName: "Joana",
          fromMe: false,
          isGroup: false,
          messageType: "Conversation",
          text: "Oi, vocês atendem sábado?",
          messageTimestamp: NOW,
        },
      },
      "r1abc"
    );
    expect(m).toMatchObject({
      kind: "message",
      provider: "UAZAPI",
      providerSessionId: "r1abc",
      providerMessageId: "3EB0AA",
      chatJid: "5511988887777@s.whatsapp.net",
      phoneE164: "+5511988887777",
      pushName: "Joana",
      sentBy: "CONTACT",
      type: "text",
      body: "Oi, vocês atendem sábado?",
      timestamp: NOW,
      isHistory: false,
    });
  });

  it("mídia, mensagem do dono pelo celular e eco da API", () => {
    const img = normalizeUazapi(
      { ...base, EventType: "messages", message: { messageid: "I1", chatid: "5511988887777@s.whatsapp.net", messageType: "ImageMessage", text: "foto", content: { mimetype: "image/jpeg" }, messageTimestamp: NOW } },
      "r1"
    )[0];
    expect(img).toMatchObject({ type: "image", media: { mime: "image/jpeg", ref: null } });
    const own = normalizeUazapi({ ...base, EventType: "messages", message: { messageid: "O1", chatid: "5511988887777@s.whatsapp.net", fromMe: true, messageType: "Conversation", text: "já respondo" } }, "r1")[0];
    expect(own).toMatchObject({ fromMe: true, sentBy: "USER_PHONE", pushName: null });
    const echo = normalizeUazapi({ ...base, EventType: "messages", message: { messageid: "E1", chatid: "5511988887777@s.whatsapp.net", fromMe: true, wasSentByApi: true, text: "eco" } }, "r1");
    expect(echo).toEqual([]);
    expect(mapUazapiType("PttMessage")).toBe("audio");
    expect(mapUazapiType("DocumentWithCaptionMessage")).toBe("document");
    expect(normalizeUazapi({ ...base, EventType: "messages", message: { messageid: "S", chatid: "status@broadcast" } }, "r1")).toEqual([]);
  });

  it("entrega e leitura (só das nossas mensagens; recibo de grupo fica de fora)", () => {
    const acks = normalizeUazapi(
      { ...base, EventType: "messages_update", type: "ReadReceipt", state: "Read", event: { MessageIDs: ["A", "B"], Timestamp: 1791300000, IsFromMe: true, Type: "Read" } },
      "r1"
    );
    expect(acks).toEqual([
      { kind: "ack", provider: "UAZAPI", providerSessionId: "r1", providerMessageId: "A", ack: "read", timestamp: 1791300000000 },
      { kind: "ack", provider: "UAZAPI", providerSessionId: "r1", providerMessageId: "B", ack: "read", timestamp: 1791300000000 },
    ]);
    expect(normalizeUazapi({ ...base, EventType: "messages_update", state: "Delivered", event: { MessageIDs: ["A"], IsFromMe: true } }, "r1")[0]).toMatchObject({ ack: "delivered" });
    expect(normalizeUazapi({ ...base, EventType: "messages_update", type: "GroupReceipts", event: { MessageIDs: ["A"], IsFromMe: true } }, "r1")).toEqual([]);
    expect(normalizeUazapi({ ...base, EventType: "messages_update", state: "Read", event: { MessageIDs: ["A"], IsFromMe: false } }, "r1")).toEqual([]);
  });

  it("conexão e banimento temporário", () => {
    expect(normalizeUazapi({ ...base, EventType: "connection", instance: { status: "connected" } }, "r1", NOW)[0]).toMatchObject({
      kind: "session",
      status: "CONNECTED",
      phoneE164: "+5511912345678",
    });
    expect(normalizeUazapi({ ...base, EventType: "connection", type: "TemporaryBan", instance: { status: "disconnected" } }, "r1")[0]).toMatchObject({
      status: "RESTRICTED",
    });
    expect(normalizeUazapi({ ...base, EventType: "history", event: "messages", messages: [{ messageid: "H" }] }, "r1")).toEqual([]);
  });

  it("segredo comparado em tempo constante, com tamanhos diferentes também", () => {
    expect(sameSecret("abc", "abc")).toBe(true);
    expect(sameSecret("abc", "abcd")).toBe(false);
    expect(sameSecret("", "")).toBe(false);
    expect(sameSecret(null, "x")).toBe(false);
  });
});

describe("webhook da uazapi", () => {
  const INSTANCE_TOKEN = "tok-instancia-" + "y".repeat(20);
  const rateLimitStore = { incr: async () => 1, expire: async () => 1 };

  function ctx() {
    return setup({ id: "sess_u", provider: "UAZAPI", providerSessionId: "r1abc", webhookSecret: URL_SECRET, instanceToken: INSTANCE_TOKEN, riskAcceptedAt: new Date(NOW) });
  }

  function msgBody(id: string, extra: Record<string, unknown> = {}) {
    return JSON.stringify({
      EventType: "messages",
      owner: "5511912345678",
      token: INSTANCE_TOKEN,
      BaseUrl: "https://x.uazapi.com",
      instanceName: "le",
      message: { messageid: id, chatid: "5511988887777@s.whatsapp.net", senderName: "Joana", fromMe: false, messageType: "Conversation", text: "Oi", messageTimestamp: NOW },
      ...extra,
    });
  }

  async function post(c: ReturnType<typeof ctx>, rawBody: string, sessionId = "sess_u", secret = URL_SECRET) {
    return handleUazapiWebhook(
      { headers: new Headers({ "content-type": "application/json" }), rawBody, ip: "10.0.0.9", sessionId, secret },
      { repo: c.repo, queue: c.queue, now: () => NOW, rateLimitStore }
    );
  }

  it("válido: grava o evento normalizado (sem o token) e enfileira", async () => {
    const c = ctx();
    const res = await post(c, msgBody("3EB0AA"));
    expect(res).toEqual({ status: 200, body: { ok: true, queued: 1, duplicate: 0, ignored: 0 } });
    expect(c.queue.ingest).toHaveLength(1);
    const stored = [...c.repo.webhookEvents.values()][0];
    expect(stored.dedupeKey).toBe("uazapi:r1abc:msg:3EB0AA");
    expect(JSON.stringify(stored.payload)).not.toContain(INSTANCE_TOKEN);
    // Ingest grava contato, conversa e mensagem.
    const out = await processIngestJob(c.queue.ingest[0], { repo: c.repo });
    expect(out).toMatchObject({ kind: "message", created: true });
    expect([...c.repo.messages.values()][0]).toMatchObject({ providerMessageId: "3EB0AA", sentBy: "CONTACT", body: "Oi" });
  });

  it("o mesmo evento de novo não duplica", async () => {
    const c = ctx();
    await post(c, msgBody("3EB0AA"));
    const again = await post(c, msgBody("3EB0AA"));
    expect(again.body).toMatchObject({ duplicate: 1 });
    expect(c.queue.ingest).toHaveLength(1);
  });

  it("segredo errado, sessão desconhecida ou de outro provedor: 401 e nada gravado", async () => {
    const c = ctx();
    expect((await post(c, msgBody("X1"), "sess_u", "errado")).status).toBe(401);
    expect((await post(c, msgBody("X2"), "nao_existe")).status).toBe(401);
    expect((await post(c, msgBody("X3"), "sess_u", "")).status).toBe(401);
    const owa = setup();
    expect((await post(owa, msgBody("X4"), "sess_1", "segredo-do-numero-123")).status).toBe(401);
    expect(c.repo.webhookEvents.size).toBe(0);
    expect(c.queue.ingest).toHaveLength(0);
  });

  it("token da instância no corpo diferente do guardado: 401", async () => {
    const c = ctx();
    const res = await post(c, msgBody("X5", { token: "outro-token" }));
    expect(res.status).toBe(401);
    expect(c.repo.webhookEvents.size).toBe(0);
  });

  it("histórico é ignorado sem gravar nada", async () => {
    const c = ctx();
    const res = await post(
      c,
      JSON.stringify({ EventType: "history", token: INSTANCE_TOKEN, event: "messages", messages: [{ messageid: "H1", chatid: "5511988887777@s.whatsapp.net", text: "antiga" }] })
    );
    expect(res).toEqual({ status: 200, body: { ok: true, ignored: 1 } });
    expect(c.repo.webhookEvents.size).toBe(0);
    expect(c.queue.ingest).toHaveLength(0);
  });

  it("JSON inválido: 400; corpo grande: 413", async () => {
    const c = ctx();
    expect((await post(c, "{nao é json")).status).toBe(400);
    expect((await post(c, "x".repeat(2 * 1024 * 1024 + 1))).status).toBe(413);
  });

  it("status de entrega e lido atualizam a mensagem enviada (sem voltar)", async () => {
    const c = ctx();
    const { conversation } = await seedConversation(c.repo, c.session, 60_000);
    await c.repo.insertMessage({
      ownerUserId: "user_a",
      conversationId: conversation.id,
      sessionId: "sess_u",
      providerMessageId: "3EB0OUT",
      fromMe: true,
      sentBy: "AGENT",
      type: "text",
      body: "oi",
      quotedId: null,
      ack: "sent",
      agentRunId: null,
      sentAt: new Date(NOW),
    });
    const ack = (state: string) =>
      JSON.stringify({ EventType: "messages_update", token: INSTANCE_TOKEN, type: "ReadReceipt", state, event: { MessageIDs: ["3EB0OUT"], IsFromMe: true, Timestamp: 1791300000 } });
    await post(c, ack("Read"));
    await post(c, ack("Delivered"));
    for (const job of c.queue.ingest.splice(0)) await processIngestJob(job, { repo: c.repo });
    expect([...c.repo.messages.values()].find((m) => m.providerMessageId === "3EB0OUT")?.ack).toBe("read");
  });

  it("evento de conexão muda o status do número", async () => {
    const c = ctx();
    c.repo.sessions.get("sess_u")!.status = "QR_READY";
    await post(c, JSON.stringify({ EventType: "connection", token: INSTANCE_TOKEN, owner: "5511912345678", event_id: "ev-1", instance: { status: "connected" } }));
    await processIngestJob(c.queue.ingest[0], { repo: c.repo });
    expect(c.repo.sessions.get("sess_u")).toMatchObject({ status: "CONNECTED", phoneE164: "+5511912345678" });
  });
});

describe("envio pela fila com o conector uazapi (ritmo humano mantido)", () => {
  it("cada bolha liga o digitando, envia e desliga; o id da uazapi fica gravado", async () => {
    const { created } = await newInstance();
    fake.pair(created.instanceId);
    const c = setup({ id: "sess_1", provider: "UAZAPI", providerSessionId: created.instanceId, instanceToken: created.token });
    const { conversation } = await seedConversation(c.repo, c.session, 60_000);
    const sleeps: number[] = [];
    const res = await processSendJob(
      {
        outboxId: "out_9",
        request: { ownerUserId: "user_a", sessionId: "sess_1", conversationId: conversation.id, sentBy: "AGENT", content: { type: "text", text: "a" } },
        plan: [
          { text: "Oi!", waitBeforeTypingMs: 1500, typingMs: 1200 },
          { text: "Te explico já.", waitBeforeTypingMs: 400, typingMs: 1300 },
        ],
        nextIndex: 0,
      },
      {
        repo: c.repo,
        getConnector: (s) => createConnector(s, { credentials: { uazapi: uazapiCredentialsFor(s, { UAZAPI_SERVER_URL: fake.url })! } }),
        limiter: new InMemorySendRateLimiter(),
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        now: () => NOW,
      }
    );
    expect(res).toEqual({ status: "sent", sent: 2 });
    expect(sleeps).toEqual([1500, 1200, 400, 1300]);
    const seq = fake.calls.filter((x) => x.path === "/message/presence" || x.path === "/send/text").map((x) => (x.path === "/send/text" ? `send:${(x.body as { text: string }).text}` : (x.body as { presence: string }).presence));
    expect(seq).toEqual(["composing", "send:Oi!", "paused", "composing", "send:Te explico já.", "paused"]);
    const sent = [...c.repo.messages.values()].filter((m) => m.fromMe);
    expect(sent.map((m) => m.providerMessageId)).toEqual([expect.stringMatching(/^3EB0/), expect.stringMatching(/^3EB0/)]);
    expect(sent.every((m) => m.sentBy === "AGENT")).toBe(true);
  });
});
