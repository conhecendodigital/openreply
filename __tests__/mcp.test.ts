import { describe, expect, it, vi } from "vitest";
import { bearerMatches } from "../lib/api-token";
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
        params: { name: "enviar_dm", arguments: { recipientId: "1", text: "oi" } },
      },
      fakeCall({ success: false, error: "outside of allowed window" }, 502)
    );
    expect(res?.result).toMatchObject({ isError: true });
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
