/** Peças falsas compartilhadas pelos testes do conector de WhatsApp. */
import type { WaIngestJob, WaQueuePort, WaSendJob } from "@/lib/whatsapp/queue";
import { InMemoryWaRepository } from "@/lib/whatsapp/repository";
import type { WaSessionRecord } from "@/lib/whatsapp/types";

export const NOW = Date.UTC(2026, 9, 6, 15, 0, 0);
export const OPENWA_SECRET = "segredo-do-numero-123";
export const META_SECRET = "segredo-do-app-meta";

export class FakeQueue implements WaQueuePort {
  ingest: WaIngestJob[] = [];
  send: WaSendJob[] = [];
  failNextIngest = false;
  async addIngest(job: WaIngestJob) {
    if (this.failNextIngest) {
      this.failNextIngest = false;
      throw new Error("redis fora");
    }
    this.ingest.push(job);
  }
  async addSend(job: WaSendJob) {
    this.send.push(job);
  }
}

export function makeSession(overrides: Partial<WaSessionRecord> = {}): WaSessionRecord {
  return {
    id: "sess_1",
    ownerUserId: "user_a",
    workspaceId: "ws_a",
    provider: "OPENWA",
    providerSessionId: "owa-1",
    phoneE164: "+5511900000000",
    status: "CONNECTED",
    webhookSecret: OPENWA_SECRET,
    riskAcceptedAt: new Date(NOW - 86_400_000),
    wabaId: null,
    ...overrides,
  };
}

export function setup(overrides: Partial<WaSessionRecord> = {}) {
  const repo = new InMemoryWaRepository();
  const session = repo.addSession(makeSession(overrides));
  const queue = new FakeQueue();
  return { repo, session, queue };
}

/** Conversa com uma mensagem do contato `ageMs` atrás. */
export async function seedConversation(repo: InMemoryWaRepository, session: WaSessionRecord, ageMs: number | null) {
  const contact = await repo.upsertContact({
    ownerUserId: session.ownerUserId,
    sessionId: session.id,
    jid: "5511988887777@c.us",
    phoneE164: "+5511988887777",
    pushName: "Cliente",
  });
  const conversation = await repo.upsertConversation({ ownerUserId: session.ownerUserId, sessionId: session.id, contactId: contact.id });
  if (ageMs !== null) {
    await repo.insertMessage({
      ownerUserId: session.ownerUserId,
      conversationId: conversation.id,
      sessionId: session.id,
      providerMessageId: "in-1",
      fromMe: false,
      sentBy: "CONTACT",
      type: "text",
      body: "Oi, quanto custa?",
      quotedId: null,
      ack: "delivered",
      agentRunId: null,
      sentAt: new Date(NOW - ageMs),
    });
  }
  return { contact, conversation };
}

export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** fetch falso: grava as chamadas e responde com `respond(url)`. */
export function fakeFetch(respond: (url: string, method: string) => { status?: number; json?: unknown } = () => ({ json: {} })) {
  const calls: FetchCall[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    const r = respond(url, method);
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  };
  return { fn, calls };
}
