import { describe, expect, it, vi } from "vitest";
import {
  API_TOKEN_PREFIX,
  bearerMatches,
  extractBearer,
  generateApiToken,
  hashApiToken,
} from "../lib/api-token";
import { handleMcpMessage, TOOLS, type InternalCall } from "../lib/mcp/server";

const TOKEN = "a".repeat(40);

describe("bearerMatches", () => {
  it("accepts the configured token", () => {
    expect(bearerMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(bearerMatches(`bearer ${TOKEN}`, TOKEN)).toBe(true);
  });

  it("rejects wrong, missing or malformed headers", () => {
    expect(bearerMatches(`Bearer ${"b".repeat(40)}`, TOKEN)).toBe(false);
    expect(bearerMatches(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(bearerMatches(TOKEN, TOKEN)).toBe(false);
    expect(bearerMatches(null, TOKEN)).toBe(false);
  });

  it("stays disabled when the token is unset or too short", () => {
    expect(bearerMatches(`Bearer ${TOKEN}`, undefined)).toBe(false);
    expect(bearerMatches("Bearer changeme", "changeme")).toBe(false);
  });
});

describe("workspace API keys", () => {
  it("generates long, prefixed, unique keys", () => {
    const a = generateApiToken();
    const b = generateApiToken();
    expect(a.token.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(a.token.length).toBeGreaterThanOrEqual(40);
    expect(a.token).not.toBe(b.token);
    expect(a.token.startsWith(a.prefix)).toBe(true);
  });

  it("stores a hash, never the key", () => {
    const { token, tokenHash } = generateApiToken();
    expect(tokenHash).toBe(hashApiToken(token));
    expect(tokenHash).not.toContain(token);
    expect(tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reads the key out of a bearer header", () => {
    expect(extractBearer("Bearer or_abc")).toBe("or_abc");
    expect(extractBearer("Basic xyz")).toBeNull();
    expect(extractBearer(undefined)).toBeNull();
  });
});

function fakeCall(json: unknown = { success: true, data: [] }, status = 200) {
  return vi.fn<InternalCall>(async () => ({ status, json }));
}

describe("handleMcpMessage", () => {
  it("answers initialize with tool capability", async () => {
    const res = await handleMcpMessage(
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } },
      fakeCall()
    );
    expect(res).toMatchObject({
      id: 1,
      result: { protocolVersion: "2025-03-26", capabilities: { tools: {} } },
    });
  });

  it("returns nothing for notifications", async () => {
    expect(
      await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }, fakeCall())
    ).toBeNull();
  });

  it("lists every tool without the internal runner", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }, fakeCall());
    const tools = (res?.result as { tools: Record<string, unknown>[] }).tools;
    expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    expect(tools.every((t) => !("run" in t))).toBe(true);
  });

  it("always creates campaigns paused, even when asked to activate", async () => {
    const call = fakeCall({ success: true, data: { id: "c1", name: "COMANDO" } }, 201);
    await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "criar_automacao",
          arguments: { name: "COMANDO", dmMessage: "oi", isActive: true, matchAnyPost: true },
        },
      },
      call
    );
    expect(call).toHaveBeenCalledWith(
      "POST",
      "/api/automations",
      expect.objectContaining({ isActive: false, matchAnyPost: true })
    );
  });

  it("dmFormat: criar sai em text por padrão, aceita button, e editar repassa o campo", async () => {
    const run = (name: string, args: Record<string, unknown>, call: InternalCall) =>
      TOOLS.find((t) => t.name === name)!.run(args, call);
    const created = fakeCall({ success: true, data: { id: "c1", name: "X" } }, 201);
    await run("criar_automacao", { name: "X", dmMessage: "oi {link}" }, created);
    await run("criar_automacao", { name: "Y", dmMessage: "oi", dmFormat: "button" }, created);
    expect(created.mock.calls[0][2]).toMatchObject({ dmFormat: "text", isActive: false });
    expect(created.mock.calls[1][2]).toMatchObject({ dmFormat: "button" });

    const edited = fakeCall({ success: true, data: {} });
    await run("editar_automacao", { id: "c1", dmFormat: "text" }, edited);
    expect(edited).toHaveBeenCalledWith("PATCH", "/api/automations?id=c1", { dmFormat: "text" });

    const schema = TOOLS.find((t) => t.name === "editar_automacao")!.inputSchema as {
      properties: Record<string, { enum?: string[]; description?: string }>;
    };
    expect(schema.properties.dmFormat.enum).toEqual(["button", "text"]);
    expect(schema.properties.dmFormat.description).toMatch(/desligada/);

    const listed = fakeCall({
      success: true,
      data: [
        { id: "a", name: "A", isActive: false, keywords: [], matchAnyPost: false, matchAnyWord: true, dmTriggerEnabled: false, postUrl: null, dmFormat: "TEXT" },
        { id: "b", name: "B", isActive: false, keywords: [], matchAnyPost: false, matchAnyWord: true, dmTriggerEnabled: false, postUrl: null },
      ],
    });
    const res = await run("listar_automacoes", {}, listed);
    const rows = JSON.parse(res.content[0].text) as { formatoDm: string }[];
    expect(rows.map((r) => r.formatoDm)).toEqual(["text", "button"]);
  });

  it("editing never toggles the campaign", async () => {
    const call = fakeCall({ success: true, data: {} });
    await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "editar_automacao", arguments: { id: "c1", dmMessage: "novo", isActive: true } },
      },
      call
    );
    expect(call).toHaveBeenCalledWith("PATCH", "/api/automations?id=c1", { dmMessage: "novo" });
  });

  it("surfaces API errors as tool errors", async () => {
    const res = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "ler_conversa", arguments: { conversationId: "c1" } },
      },
      fakeCall({ success: false, error: "outside of allowed window" }, 502)
    );
    expect(res?.result).toMatchObject({ isError: true });
  });

  it("mentions that moderation starts in observe mode", async () => {
    const res = await handleMcpMessage({ jsonrpc: "2.0", id: 8, method: "initialize" }, fakeCall());
    expect((res?.result as { instructions: string }).instructions).toMatch(/modo observar/);
  });

  it("refuses to switch moderation to hide without confirmar", async () => {
    const call = fakeCall();
    const res = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "configurar_moderacao", arguments: { modo: "esconder" } },
      },
      call
    );
    expect(res?.result).toMatchObject({ isError: true });
    expect(call).not.toHaveBeenCalled();
  });

  it("switches moderation to hide only with confirmar: true", async () => {
    const call = fakeCall({ success: true, data: { mode: "HIDE" } });
    await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "configurar_moderacao",
          arguments: { modo: "esconder", confirmar: true, termosBloqueados: ["concorrente"] },
        },
      },
      call
    );
    expect(call).toHaveBeenCalledWith("PATCH", "/api/moderation/settings", {
      mode: "HIDE",
      blockedTerms: ["concorrente"],
    });
  });

  it("observe mode needs no confirmation", async () => {
    const call = fakeCall({ success: true, data: {} });
    await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "configurar_moderacao", arguments: { modo: "observar" } },
      },
      call
    );
    expect(call).toHaveBeenCalledWith("PATCH", "/api/moderation/settings", { mode: "OBSERVE" });
  });

  it("hides a recorded comment only with confirmar, and only by record id", async () => {
    const refused = fakeCall();
    const res = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: { name: "esconder_comentario", arguments: { id: "mod_1" } },
      },
      refused
    );
    expect(res?.result).toMatchObject({ isError: true });
    expect(refused).not.toHaveBeenCalled();

    const call = fakeCall({ success: true, data: {} });
    await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: { name: "esconder_comentario", arguments: { id: "mod_1", confirmar: true } },
      },
      call
    );
    expect(call).toHaveBeenCalledWith("POST", "/api/moderation/log/mod_1/hide", undefined);
  });

  it("restores a hidden comment by record id", async () => {
    const call = fakeCall({ success: true, data: {} });
    await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 14,
        method: "tools/call",
        params: { name: "restaurar_comentario", arguments: { id: "mod_1" } },
      },
      call
    );
    expect(call).toHaveBeenCalledWith("POST", "/api/moderation/log/mod_1/restore", undefined);
  });

  it("lists contacts with search and tag filters", async () => {
    const call = fakeCall({ success: true, data: { contacts: [] } });
    await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 15,
        method: "tools/call",
        params: { name: "listar_contatos", arguments: { busca: "@ana", etiqueta: "clicou", limite: 5 } },
      },
      call
    );
    expect(call).toHaveBeenCalledWith("GET", "/api/contacts?q=%40ana&tag=clicou&limit=5", undefined);
  });

  it("tags and annotates contacts through POST/PATCH", async () => {
    const call = fakeCall({ success: true, data: {} });
    await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 16,
        method: "tools/call",
        params: { name: "etiquetar_contato", arguments: { id: "ct_1", adicionar: ["vip"], remover: ["frio"] } },
      },
      call
    );
    expect(call).toHaveBeenCalledWith("POST", "/api/contacts/ct_1/tags", { add: ["vip"], remove: ["frio"] });

    await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 17,
        method: "tools/call",
        params: { name: "anotar_contato", arguments: { id: "ct_1", nota: "comprou o Comandos Pro" } },
      },
      call
    );
    expect(call).toHaveBeenCalledWith("PATCH", "/api/contacts/ct_1", { notes: "comprou o Comandos Pro" });
  });

  it("rejects unknown tools and methods", async () => {
    const call = fakeCall();
    expect(
      await handleMcpMessage(
        { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "apagar_tudo" } },
        call
      )
    ).toMatchObject({ error: { code: -32602 } });
    expect(await handleMcpMessage({ jsonrpc: "2.0", id: 7, method: "nope" }, call)).toMatchObject({
      error: { code: -32601 },
    });
  });
});
