/**
 * WhatsApp: regra das 24h, ritmo humano (tempo e quebra) e troca de conector.
 */
import { describe, expect, it } from "vitest";
import type { WhatsAppConnector } from "@/lib/whatsapp/connector";
import { CloudApiConnector } from "@/lib/whatsapp/cloud-api";
import { createConnector } from "@/lib/whatsapp/factory";
import { OpenWAConnector } from "@/lib/whatsapp/openwa";
import { enqueueOutbound, processSendJob } from "@/lib/whatsapp/outbound";
import {
  DEFAULT_PACING,
  InMemorySendRateLimiter,
  isWithinReplyWindow,
  planBubbles,
  REPLY_WINDOW_MS,
  splitIntoBubbles,
  typingDelayMs,
} from "@/lib/whatsapp/pacing";
import type { OutboundRequest, WaSessionRecord } from "@/lib/whatsapp/types";
import { fakeFetch, NOW, seedConversation, setup } from "./wa-helpers";

const HOUR = 60 * 60 * 1000;
const fixedRand = () => 0.5;

function textRequest(conversationId: string, text: string, sentBy: OutboundRequest["sentBy"] = "AGENT"): OutboundRequest {
  return { ownerUserId: "user_a", sessionId: "sess_1", conversationId, sentBy, content: { type: "text", text }, agentRunId: "run_1" };
}

/** Relógio falso: sleep avança o tempo e registra cada espera. */
function fakeClock(start = NOW) {
  let t = start;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
    sleeps,
  };
}

type Call = { op: string; to?: string; text?: string; key?: string; on?: boolean; at: number; replyTo?: string | null };

function recordingConnector(clock: { now: () => number }, provider: "OPENWA" | "CLOUD_API" = "OPENWA") {
  const calls: Call[] = [];
  let n = 0;
  const c: WhatsAppConnector = {
    provider,
    connect: async () => ({ status: "CONNECTED", qr: null }),
    getQr: async () => null,
    getStatus: async () => "CONNECTED",
    sendText: async (to, text, o) => {
      calls.push({ op: "send", to, text, key: o?.idempotencyKey, at: clock.now() });
      n += 1;
      return { providerMessageId: `out-${n}`, timestamp: clock.now() };
    },
    sendMedia: async (to, media, o) => {
      calls.push({ op: "media", to, text: media.caption, key: o?.idempotencyKey, at: clock.now() });
      n += 1;
      return { providerMessageId: `out-${n}`, timestamp: clock.now() };
    },
    sendTemplate: async () => {
      throw new Error("sem template");
    },
    setTyping: async (to, on, o) => {
      calls.push({ op: "typing", to, on, at: clock.now(), replyTo: o?.replyToProviderMessageId ?? null });
    },
    markRead: async () => {},
    disconnect: async () => {},
  };
  return { connector: c, calls };
}

describe("regra das 24h", () => {
  it("janela: aberta até 24h, fechada depois e sem mensagem do contato", () => {
    expect(isWithinReplyWindow(new Date(NOW - 23 * HOUR), NOW)).toBe(true);
    expect(isWithinReplyWindow(new Date(NOW - REPLY_WINDOW_MS + 1000), NOW)).toBe(true);
    expect(isWithinReplyWindow(new Date(NOW - REPLY_WINDOW_MS), NOW)).toBe(false);
    expect(isWithinReplyWindow(new Date(NOW - 30 * HOUR), NOW)).toBe(false);
    expect(isWithinReplyWindow(null, NOW)).toBe(false);
  });

  it("dentro de 24h: entra na fila", async () => {
    const ctx = setup();
    const { conversation } = await seedConversation(ctx.repo, ctx.session, 23 * HOUR);
    const res = await enqueueOutbound(textRequest(conversation.id, "Atendo sim!"), { repo: ctx.repo, queue: ctx.queue, now: () => NOW, rand: fixedRand });
    expect(res.status).toBe("queued");
    expect(ctx.queue.send).toHaveLength(1);
    expect(ctx.repo.blocked).toHaveLength(0);
  });

  it("fora de 24h: bloqueia, registra e não enfileira", async () => {
    const ctx = setup();
    const { conversation } = await seedConversation(ctx.repo, ctx.session, 25 * HOUR);
    const res = await enqueueOutbound(textRequest(conversation.id, "Oi de novo"), { repo: ctx.repo, queue: ctx.queue, now: () => NOW });
    expect(res).toEqual({ status: "blocked", reason: "fora_da_janela_24h" });
    expect(ctx.queue.send).toHaveLength(0);
    expect(ctx.repo.blocked).toHaveLength(1);
    expect(ctx.repo.blocked[0]).toMatchObject({ reason: "fora_da_janela_24h", agentRunId: "run_1", sentBy: "AGENT", preview: "Oi de novo" });
  });

  it("conversa sem mensagem do contato: bloqueia (nada de puxar conversa)", async () => {
    const ctx = setup();
    const { conversation } = await seedConversation(ctx.repo, ctx.session, null);
    const res = await enqueueOutbound(textRequest(conversation.id, "Oi"), { repo: ctx.repo, queue: ctx.queue, now: () => NOW });
    expect(res).toEqual({ status: "blocked", reason: "sem_mensagem_do_contato" });
  });

  it("mensagem do próprio dono pelo celular não abre janela", async () => {
    const ctx = setup();
    const { conversation } = await seedConversation(ctx.repo, ctx.session, 30 * HOUR);
    await ctx.repo.insertMessage({
      ownerUserId: "user_a",
      conversationId: conversation.id,
      sessionId: "sess_1",
      providerMessageId: "eco-1",
      fromMe: true,
      sentBy: "USER_PHONE",
      type: "text",
      body: "e aí?",
      quotedId: null,
      ack: "sent",
      agentRunId: null,
      sentAt: new Date(NOW - HOUR),
    });
    const res = await enqueueOutbound(textRequest(conversation.id, "Oi"), { repo: ctx.repo, queue: ctx.queue, now: () => NOW });
    expect(res).toMatchObject({ status: "blocked", reason: "fora_da_janela_24h" });
  });

  it("vale também pra template da Cloud API", async () => {
    const ctx = setup({ provider: "CLOUD_API" });
    const { conversation } = await seedConversation(ctx.repo, ctx.session, 48 * HOUR);
    const res = await enqueueOutbound(
      { ...textRequest(conversation.id, ""), content: { type: "template", name: "lembrete", language: "pt_BR" } },
      { repo: ctx.repo, queue: ctx.queue, now: () => NOW }
    );
    expect(res).toMatchObject({ status: "blocked", reason: "fora_da_janela_24h" });
  });

  it("janela fecha no meio do envio: para as bolhas que faltam e registra", async () => {
    const ctx = setup();
    const { conversation } = await seedConversation(ctx.repo, ctx.session, REPLY_WINDOW_MS - 3_000);
    const clock = fakeClock();
    await enqueueOutbound(textRequest(conversation.id, "Primeira parte.\n\nSegunda parte.\n\nTerceira parte."), {
      repo: ctx.repo,
      queue: ctx.queue,
      now: clock.now,
      rand: fixedRand,
    });
    const { connector, calls } = recordingConnector(clock);
    const res = await processSendJob(ctx.queue.send[0], {
      repo: ctx.repo,
      getConnector: () => connector,
      limiter: new InMemorySendRateLimiter(),
      sleep: clock.sleep,
      now: clock.now,
    });
    expect(res).toMatchObject({ status: "blocked", reason: "fora_da_janela_24h", sent: 1 });
    expect(calls.filter((c) => c.op === "send")).toHaveLength(1);
    expect(ctx.repo.blocked.at(-1)?.reason).toBe("fora_da_janela_24h");
  });

  it('"Assumir": agente para, humano no app continua mandando', async () => {
    const ctx = setup();
    const { conversation } = await seedConversation(ctx.repo, ctx.session, HOUR);
    ctx.repo.conversations.get(conversation.id)!.humanTakeoverUntil = new Date(NOW + HOUR);
    const agent = await enqueueOutbound(textRequest(conversation.id, "Oi"), { repo: ctx.repo, queue: ctx.queue, now: () => NOW });
    const human = await enqueueOutbound(textRequest(conversation.id, "Oi", "USER_APP"), { repo: ctx.repo, queue: ctx.queue, now: () => NOW });
    expect(agent).toEqual({ status: "blocked", reason: "humano_assumiu" });
    expect(human.status).toBe("queued");
  });

  it("número desconectado: não envia e registra", async () => {
    const ctx = setup({ status: "DISCONNECTED" });
    const { conversation } = await seedConversation(ctx.repo, ctx.session, HOUR);
    await enqueueOutbound(textRequest(conversation.id, "Oi"), { repo: ctx.repo, queue: ctx.queue, now: () => NOW });
    const clock = fakeClock();
    const { connector, calls } = recordingConnector(clock);
    const res = await processSendJob(ctx.queue.send[0], {
      repo: ctx.repo,
      getConnector: () => connector,
      limiter: new InMemorySendRateLimiter(),
      sleep: clock.sleep,
      now: clock.now,
    });
    expect(res).toMatchObject({ status: "blocked", reason: "sessao_desconectada" });
    expect(calls).toHaveLength(0);
  });
});

describe("ritmo humano: quebra", () => {
  it("parágrafos viram bolhas e nenhum texto some", () => {
    const text = "Oi, Joana! Tudo bem?\n\nAtendo sim, de segunda a sábado.\n\nQuer que eu reserve um horário?";
    const bubbles = splitIntoBubbles(text);
    expect(bubbles).toEqual(["Oi, Joana! Tudo bem?", "Atendo sim, de segunda a sábado.", "Quer que eu reserve um horário?"]);
  });

  it("parágrafo longo quebra por frase dentro do limite", () => {
    const sentence = "Essa é uma frase de tamanho médio pra testar a quebra. ";
    const text = sentence.repeat(10).trim();
    const bubbles = splitIntoBubbles(text, { maxBubbleChars: 120, maxBubbles: 10 });
    expect(bubbles.length).toBeGreaterThan(1);
    for (const b of bubbles) expect(b.length).toBeLessThanOrEqual(120);
    expect(bubbles.join(" ").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
  });

  it("frase gigante sem pontuação quebra em espaço", () => {
    const text = Array.from({ length: 80 }, (_, i) => `palavra${i}`).join(" ");
    const bubbles = splitIntoBubbles(text, { maxBubbleChars: 100, maxBubbles: 20 });
    for (const b of bubbles) expect(b.length).toBeLessThanOrEqual(100);
    expect(bubbles.join(" ")).toBe(text);
  });

  it("acima do máximo de bolhas, o resto vai junto na última", () => {
    const text = ["um", "dois", "três", "quatro", "cinco", "seis", "sete"].join("\n\n");
    const bubbles = splitIntoBubbles(text, { maxBubbleChars: 220, maxBubbles: 5 });
    expect(bubbles).toHaveLength(5);
    expect(bubbles[4]).toBe("cinco\n\nseis\n\nsete");
  });
});

describe("ritmo humano: tempo", () => {
  it("digitando é proporcional ao tamanho, com piso e teto", () => {
    const short = typingDelayMs("ok", fixedRand);
    const medium = typingDelayMs("x".repeat(60), fixedRand);
    const long = typingDelayMs("x".repeat(100), fixedRand);
    const huge = typingDelayMs("x".repeat(5000), fixedRand);
    expect(short).toBe(DEFAULT_PACING.typingMinMs);
    expect(long).toBeGreaterThan(medium);
    expect(huge).toBe(DEFAULT_PACING.typingMaxMs);
  });

  it("varia com o sorteio dentro da faixa", () => {
    const text = "x".repeat(80);
    const low = typingDelayMs(text, () => 0);
    const high = typingDelayMs(text, () => 0.999);
    expect(low).toBe(Math.round(80 * 60 * 0.8));
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(Math.round(80 * 60 * 1.25));
  });

  it("primeira bolha espera a leitura; as outras, a pausa curta", () => {
    const plan = planBubbles("Oi!\n\nTudo certo?", fixedRand);
    expect(plan[0].waitBeforeTypingMs).toBe(2750); // meio de [1500, 4000]
    expect(plan[1].waitBeforeTypingMs).toBe(800); // meio de [400, 1200]
  });

  it('envio: "digitando..." antes de cada bolha, espera o tempo planejado, chave por bolha', async () => {
    const ctx = setup();
    const { conversation } = await seedConversation(ctx.repo, ctx.session, HOUR);
    const clock = fakeClock();
    await enqueueOutbound(textRequest(conversation.id, "Oi, Joana!\n\nAtendo sim."), {
      repo: ctx.repo,
      queue: ctx.queue,
      now: clock.now,
      rand: fixedRand,
    });
    const job = ctx.queue.send[0];
    const { connector, calls } = recordingConnector(clock);
    const progress: number[] = [];
    const res = await processSendJob(job, {
      repo: ctx.repo,
      getConnector: () => connector,
      limiter: new InMemorySendRateLimiter(),
      sleep: clock.sleep,
      now: clock.now,
      onProgress: async (i) => void progress.push(i),
    });
    expect(res).toEqual({ status: "sent", sent: 2 });
    expect(calls.map((c) => `${c.op}${c.on === undefined ? "" : c.on ? ":on" : ":off"}`)).toEqual([
      "typing:on",
      "send",
      "typing:off",
      "typing:on",
      "send",
      "typing:off",
    ]);
    // espera de leitura, digitando 1, pausa, digitando 2
    expect(clock.sleeps).toEqual([job.plan[0].waitBeforeTypingMs, job.plan[0].typingMs, job.plan[1].waitBeforeTypingMs, job.plan[1].typingMs]);
    const sends = calls.filter((c) => c.op === "send");
    const typingOn = calls.filter((c) => c.op === "typing" && c.on);
    expect(sends[0].at - typingOn[0].at).toBe(job.plan[0].typingMs);
    expect(sends.map((s) => s.key)).toEqual([`${job.outboxId}:0`, `${job.outboxId}:1`]);
    expect(typingOn[0].replyTo).toBe("in-1");
    expect(progress).toEqual([1, 2]);
    // As bolhas ficam gravadas como mensagens do agente.
    const out = [...ctx.repo.messages.values()].filter((m) => m.fromMe);
    expect(out.map((m) => [m.body, m.sentBy, m.agentRunId])).toEqual([
      ["Oi, Joana!", "AGENT", "run_1"],
      ["Atendo sim.", "AGENT", "run_1"],
    ]);
  });

  it("retentativa continua da bolha que faltou (não repete)", async () => {
    const ctx = setup();
    const { conversation } = await seedConversation(ctx.repo, ctx.session, HOUR);
    const clock = fakeClock();
    await enqueueOutbound(textRequest(conversation.id, "A.\n\nB.\n\nC."), { repo: ctx.repo, queue: ctx.queue, now: clock.now, rand: fixedRand });
    const job = { ...ctx.queue.send[0], nextIndex: 2 };
    const { connector, calls } = recordingConnector(clock);
    await processSendJob(job, { repo: ctx.repo, getConnector: () => connector, limiter: new InMemorySendRateLimiter(), sleep: clock.sleep, now: clock.now });
    expect(calls.filter((c) => c.op === "send").map((c) => c.text)).toEqual(["C."]);
  });

  it("limite por minuto por número: para e diz quando voltar", async () => {
    const ctx = setup();
    const { conversation } = await seedConversation(ctx.repo, ctx.session, HOUR);
    const clock = fakeClock(Math.floor(NOW / 60_000) * 60_000);
    await enqueueOutbound(textRequest(conversation.id, "1\n\n2\n\n3\n\n4"), { repo: ctx.repo, queue: ctx.queue, now: clock.now, rand: () => 0 });
    const { connector, calls } = recordingConnector(clock);
    const limiter = new InMemorySendRateLimiter(2);
    const res = await processSendJob(ctx.queue.send[0], { repo: ctx.repo, getConnector: () => connector, limiter, sleep: clock.sleep, now: clock.now });
    expect(res.status).toBe("rate_limited");
    if (res.status !== "rate_limited") return;
    expect(res.nextIndex).toBe(2);
    expect(res.sent).toBe(2);
    expect(res.retryAfterMs).toBeGreaterThan(0);
    expect(res.retryAfterMs).toBeLessThanOrEqual(60_000);
    expect(calls.filter((c) => c.op === "send")).toHaveLength(2);
    // Outro número tem o próprio limite.
    expect((await limiter.acquire("outro", clock.now())).allowed).toBe(true);
  });

  it('falha no "digitando..." não impede o envio', async () => {
    const ctx = setup();
    const { conversation } = await seedConversation(ctx.repo, ctx.session, HOUR);
    const clock = fakeClock();
    await enqueueOutbound(textRequest(conversation.id, "Oi"), { repo: ctx.repo, queue: ctx.queue, now: clock.now, rand: fixedRand });
    const { connector, calls } = recordingConnector(clock);
    connector.setTyping = async () => {
      throw new Error("falhou");
    };
    const res = await processSendJob(ctx.queue.send[0], { repo: ctx.repo, getConnector: () => connector, limiter: new InMemorySendRateLimiter(), sleep: clock.sleep, now: clock.now });
    expect(res).toEqual({ status: "sent", sent: 1 });
    expect(calls.filter((c) => c.op === "send")).toHaveLength(1);
  });
});

describe("troca de conector", () => {
  const base = (provider: WaSessionRecord["provider"]) =>
    ({ provider, providerSessionId: provider === "OPENWA" ? "owa-1" : "pn-1", riskAcceptedAt: new Date(NOW), wabaId: "waba-1" }) as const;
  const credentials = { openwa: { baseUrl: "https://gw.exemplo/", apiKey: "k-openwa" }, cloudApi: { accessToken: "t-cloud", graphVersion: "v25.0" } };

  it("escolhe o adaptador pelo provider do número", () => {
    expect(createConnector(base("OPENWA"), { credentials })).toBeInstanceOf(OpenWAConnector);
    expect(createConnector(base("CLOUD_API"), { credentials })).toBeInstanceOf(CloudApiConnector);
    expect(() => createConnector(base("OPENWA"), { credentials: {} })).toThrow();
  });

  it("mesma fila, dois conectores: cada um chama a API certa", async () => {
    for (const provider of ["OPENWA", "CLOUD_API"] as const) {
      const ctx = setup({ provider, providerSessionId: provider === "OPENWA" ? "owa-1" : "pn-1", wabaId: "waba-1" });
      const { conversation } = await seedConversation(ctx.repo, ctx.session, HOUR);
      const clock = fakeClock();
      await enqueueOutbound(textRequest(conversation.id, "Oi!\n\nTudo bem?"), { repo: ctx.repo, queue: ctx.queue, now: clock.now, rand: fixedRand });
      const f = fakeFetch((url) =>
        url.includes("/messages/send-text")
          ? { json: { messageId: `id-${Math.random()}`, timestamp: Math.floor(NOW / 1000) } }
          : url.endsWith("/messages")
            ? { json: { messages: [{ id: `wamid.${Math.random()}` }] } }
            : { json: { success: true } }
      );
      const res = await processSendJob(ctx.queue.send[0], {
        repo: ctx.repo,
        getConnector: (s) => createConnector(s, { credentials, fetch: f.fn }),
        limiter: new InMemorySendRateLimiter(),
        sleep: clock.sleep,
        now: clock.now,
      });
      expect(res).toEqual({ status: "sent", sent: 2 });
      if (provider === "OPENWA") {
        const sends = f.calls.filter((c) => c.url.endsWith("/api/sessions/owa-1/messages/send-text"));
        expect(sends).toHaveLength(2);
        expect(sends[0].headers["X-API-Key"]).toBe("k-openwa");
        expect(sends[0].headers["Idempotency-Key"]).toMatch(/:0$/);
        expect(sends[0].body).toMatchObject({ chatId: "5511988887777@c.us", text: "Oi!" });
        expect(f.calls.some((c) => c.url.endsWith("/chats/typing") && (c.body as { state: string }).state === "typing")).toBe(true);
      } else {
        const posts = f.calls.filter((c) => c.url === "https://graph.facebook.com/v25.0/pn-1/messages");
        const texts = posts.filter((c) => (c.body as { type?: string }).type === "text");
        const typing = posts.filter((c) => (c.body as { typing_indicator?: unknown }).typing_indicator);
        expect(texts).toHaveLength(2);
        expect(texts[0].body).toMatchObject({ messaging_product: "whatsapp", to: "5511988887777", text: { body: "Oi!" } });
        expect(texts[0].headers.Authorization).toBe("Bearer t-cloud");
        expect(typing[0].body).toMatchObject({ status: "read", message_id: "in-1", typing_indicator: { type: "text" } });
      }
    }
  });
});

describe("adaptador OpenWA", () => {
  it("sem aceite do termo de risco não conecta", async () => {
    const f = fakeFetch();
    const c = new OpenWAConnector({ baseUrl: "https://gw", apiKey: "k", sessionId: "s1", riskAcceptedAt: null, fetch: f.fn });
    await expect(c.connect()).rejects.toThrow(/termo de risco/);
    expect(f.calls).toHaveLength(0);
  });

  it("connect inicia a sessão e devolve o QR", async () => {
    const f = fakeFetch((url) => (url.endsWith("/start") ? { json: { id: "s1", status: "qr_ready" } } : { json: { qrCode: "data:image/png;base64,QQ", status: "qr_ready" } }));
    const c = new OpenWAConnector({ baseUrl: "https://gw", apiKey: "k", sessionId: "s1", riskAcceptedAt: new Date(), fetch: f.fn });
    expect(await c.connect()).toEqual({ status: "QR_READY", qr: "data:image/png;base64,QQ" });
    expect(f.calls.map((x) => `${x.method} ${x.url}`)).toEqual(["POST https://gw/api/sessions/s1/start", "GET https://gw/api/sessions/s1/qr"]);
  });

  it("status, mídia, lida, desconectar e template", async () => {
    const f = fakeFetch((url) =>
      url.endsWith("/api/sessions/s1") ? { json: { id: "s1", status: "ready" } } : url.includes("send-") ? { json: { messageId: "m1", timestamp: 1 } } : { json: {} }
    );
    const c = new OpenWAConnector({ baseUrl: "https://gw", apiKey: "k", sessionId: "s1", riskAcceptedAt: new Date(), fetch: f.fn });
    expect(await c.getStatus()).toBe("CONNECTED");
    await c.sendMedia("+55 11 98888-7777", { mediaType: "image", url: "https://x/img.png", caption: "olha" });
    await c.markRead("5511988887777@c.us", ["a", "b"]);
    await c.disconnect();
    await expect(c.sendTemplate("1", { name: "t", language: "pt_BR" })).rejects.toThrow(/Cloud API/);
    expect(f.calls[1]).toMatchObject({ url: "https://gw/api/sessions/s1/messages/send-image", body: { chatId: "5511988887777@c.us", url: "https://x/img.png", caption: "olha" } });
    expect(f.calls[2]).toMatchObject({ url: "https://gw/api/sessions/s1/chats/read", body: { chatId: "5511988887777@c.us", messageIds: ["a", "b"] } });
    expect(f.calls[3]).toMatchObject({ method: "POST", url: "https://gw/api/sessions/s1/logout" });
  });

  it("erro do gateway não vaza o corpo e marca se dá pra tentar de novo", async () => {
    const f = fakeFetch(() => ({ status: 503, json: { message: "texto secreto da mensagem" } }));
    const c = new OpenWAConnector({ baseUrl: "https://gw", apiKey: "k", sessionId: "s1", riskAcceptedAt: new Date(), fetch: f.fn });
    const err = await c.sendText("5511988887777", "oi").catch((e) => e);
    expect(err.retryable).toBe(true);
    expect(String(err.message)).not.toContain("secreto");
  });
});

describe("adaptador Cloud API e coexistência", () => {
  it("template, mídia por link, marcar lida e desconectar", async () => {
    const f = fakeFetch((url, method) => (url.endsWith("/messages") && method === "POST" ? { json: { messages: [{ id: "wamid.1" }] } } : { json: { success: true } }));
    const c = new CloudApiConnector({ accessToken: "t", phoneNumberId: "pn-1", wabaId: "waba-1", graphVersion: "v25.0", fetch: f.fn });
    await c.sendTemplate("5511988887777", { name: "boas_vindas", language: "pt_BR" });
    await c.sendMedia("5511988887777", { mediaType: "document", url: "https://x/a.pdf", filename: "a.pdf", caption: "segue" });
    await c.markRead("5511988887777@s.whatsapp.net", ["wamid.a", "wamid.b"]);
    await c.disconnect();
    expect(f.calls[0].body).toMatchObject({ type: "template", template: { name: "boas_vindas", language: { code: "pt_BR" } } });
    expect(f.calls[1].body).toMatchObject({ type: "document", document: { link: "https://x/a.pdf", filename: "a.pdf", caption: "segue" } });
    expect(f.calls[2].body).toEqual({ messaging_product: "whatsapp", status: "read", message_id: "wamid.b" });
    expect(f.calls[3]).toMatchObject({ method: "DELETE", url: "https://graph.facebook.com/v25.0/waba-1/subscribed_apps" });
    await expect(c.sendMedia("5511988887777", { mediaType: "image", base64: "AA" })).rejects.toThrow(/link/);
  });

  it("onboarding da coexistência: token, assinatura do WABA e sincronização", async () => {
    const { completeCoexistenceOnboarding } = await import("@/lib/whatsapp/cloud-api");
    const f = fakeFetch((url) =>
      url.includes("/oauth/access_token") ? { json: { access_token: "tok-negocio" } } : url.includes("fields=status") ? { json: { status: "CONNECTED" } } : { json: { success: true } }
    );
    const res = await completeCoexistenceOnboarding({
      code: "c0de",
      wabaId: "waba-1",
      phoneNumberId: "pn-1",
      appId: "app",
      appSecret: "sec",
      graphVersion: "v25.0",
      fetch: f.fn,
    });
    expect(res).toEqual({ accessToken: "tok-negocio", wabaId: "waba-1", phoneNumberId: "pn-1", status: "CONNECTED", historyRequested: true });
    const steps = f.calls.map((c) => `${c.method} ${c.url.split("?")[0].replace("https://graph.facebook.com/v25.0", "")}`);
    expect(steps).toEqual([
      "GET /oauth/access_token",
      "POST /waba-1/subscribed_apps",
      "POST /pn-1/smb_app_data",
      "POST /pn-1/smb_app_data",
      "GET /pn-1",
    ]);
    expect(f.calls[2].body).toMatchObject({ sync_type: "smb_app_state_sync" });
    expect(f.calls[3].body).toMatchObject({ sync_type: "history" });
    expect(f.calls[1].headers.Authorization).toBe("Bearer tok-negocio");
  });
});
