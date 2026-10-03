/**
 * Cliente da Meta: getUserProfile (User Profile API) e getStories, sem rede
 * (fetch simulado).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getStories, getUserProfile, PermissionError, RateLimitError } from "../lib/meta/client";

function reply(status: number, body: unknown) {
  return { ok: status < 400, status, url: "https://graph.instagram.com/v25.0/x", json: async () => body } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getUserProfile", () => {
  it("asks for username,name,profile_pic with the account token in the header", async () => {
    const fetchMock = vi.fn(async () => reply(200, { username: " maria ", name: "Maria", profile_pic: "https://cdn/p.jpg", id: "123" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getUserProfile("tok", "123")).toEqual({ username: "maria", name: "Maria", profilePic: "https://cdn/p.jpg" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.host).toBe("graph.instagram.com");
    expect(parsed.pathname).toMatch(/^\/v\d+\.\d+\/123$/);
    expect(parsed.searchParams.get("fields")).toBe("username,name,profile_pic");
    expect(parsed.searchParams.get("access_token")).toBeNull();
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("missing fields come back as null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(200, { id: "123" })));
    expect(await getUserProfile("tok", "123")).toEqual({ username: null, name: null, profilePic: null });
  });

  it("throws the classified Meta errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => reply(400, { error: { message: "no consent", type: "IGApiException", code: 100 } })));
    await expect(getUserProfile("tok", "123")).rejects.toBeInstanceOf(PermissionError);
    vi.stubGlobal("fetch", vi.fn(async () => reply(400, { error: { message: "slow down", type: "x", code: 4 } })));
    await expect(getUserProfile("tok", "123")).rejects.toBeInstanceOf(RateLimitError);
  });
});

describe("getStories", () => {
  it("lists the account's live stories", async () => {
    const fetchMock = vi.fn(async () => reply(200, { data: [{ id: "s1", media_type: "IMAGE" }] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getStories("tok", "ig_owner")).toEqual([{ id: "s1", media_type: "IMAGE" }]);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(new URL(url).pathname).toMatch(/\/ig_owner\/stories$/);
  });
});
