/**
 * Gatilho por frase: "Quero a aula do workshop" no número certo responde
 * sozinho com a aula + convite; respeita a regra das 24h.
 */
import { describe, expect, it } from "vitest";
import { acharGatilho, GATILHOS, montarMensagens, normalizarFrase, primeiroNome, responderGatilho, type Gatilho } from "@/lib/whatsapp/gatilhos";
import { NOW, seedConversation, setup } from "./wa-helpers";

const G: Gatilho = { id: "teste", sessionId: "sess_1", frases: ["Quero a aula do workshop"], mensagens: ["Oi{nome}! Aula: X", "Segunda"] };

describe("gatilhos por frase", () => {
  it("normaliza acento, caixa e pontuação", () => {
    expect(normalizarFrase("  QUERO a Aula do Workshop!! ")).toBe("quero a aula do workshop");
    expect(normalizarFrase("Olá, é você?")).toBe("ola e voce");
  });

  it("acha só no número certo e com a frase", () => {
    expect(acharGatilho("sess_1", "Oi! Quero a aula do workshop 🙂", [G])?.id).toBe("teste");
    expect(acharGatilho("sess_2", "Quero a aula do workshop", [G])).toBeNull();
    expect(acharGatilho("sess_1", "quanto custa?", [G])).toBeNull();
    expect(acharGatilho("sess_1", null, [G])).toBeNull();
  });

  it("põe o primeiro nome quando é nome de verdade", () => {
    expect(primeiroNome("Maria Silva")).toBe("Maria");
    expect(primeiroNome("🔥🔥")).toBe("");
    expect(montarMensagens(G, "Maria Silva")[0]).toBe("Oi, Maria! Aula: X");
    expect(montarMensagens(G, null)[0]).toBe("Oi! Aula: X");
  });

  it("o gatilho real tem o link da aula e o convite", () => {
    const aula = GATILHOS.find((g) => g.id === "aula-csf")!;
    expect(aula.mensagens[0]).toContain("drive.google.com/file/d/1G1rrU1rmOQdUoXJ4Oz9tpYYERS9_EauD");
    expect(aula.mensagens[1]).toContain("Chat Sem Frescura");
  });

  it("enfileira as 2 mensagens quando a pessoa acabou de escrever", async () => {
    const { repo, session, queue } = setup();
    const { conversation } = await seedConversation(repo, session, 1_000);
    const r = await responderGatilho(
      { ownerUserId: session.ownerUserId, sessionId: session.id, conversationId: conversation.id, body: "Quero a aula do workshop" },
      { repo, queue, now: () => NOW },
      [G]
    );
    expect(r?.result.status).toBe("queued");
    expect(queue.send).toHaveLength(1);
    expect(queue.send[0].plan.map((b) => b.text)).toEqual(["Oi, Cliente! Aula: X", "Segunda"]);
  });

  it("não manda nada fora da janela de 24h", async () => {
    const { repo, session, queue } = setup();
    const { conversation } = await seedConversation(repo, session, null);
    const r = await responderGatilho(
      { ownerUserId: session.ownerUserId, sessionId: session.id, conversationId: conversation.id, body: "Quero a aula do workshop" },
      { repo, queue, now: () => NOW },
      [G]
    );
    expect(r?.result.status).toBe("blocked");
    expect(queue.send).toHaveLength(0);
  });

  it("mensagem comum não é gatilho", async () => {
    const { repo, session, queue } = setup();
    const { conversation } = await seedConversation(repo, session, 1_000);
    const r = await responderGatilho({ ownerUserId: "user_a", sessionId: "sess_1", conversationId: conversation.id, body: "oi" }, { repo, queue }, [G]);
    expect(r).toBeNull();
    expect(queue.send).toHaveLength(0);
  });
});
