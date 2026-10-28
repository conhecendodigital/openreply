import { afterEach, describe, expect, it, vi } from "vitest";
import { getLongLivedToken, refreshLongLivedToken } from "@/lib/meta/client";

describe("troca de token do Instagram", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("usa graph.instagram.com sem versão para o token longo e a renovação", async () => {
    vi.stubEnv("INSTAGRAM_APP_SECRET", "segredo-de-teste");
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) => {
        urls.push(u);
        return new Response(JSON.stringify({ access_token: "t", expires_in: 100 }), { status: 200 });
      })
    );
    await getLongLivedToken("curto");
    await refreshLongLivedToken("longo");
    expect(urls[0]).toMatch(/^https:\/\/graph\.instagram\.com\/access_token\?/);
    expect(urls[0]).toContain("grant_type=ig_exchange_token");
    expect(urls[1]).toMatch(/^https:\/\/graph\.instagram\.com\/refresh_access_token\?/);
    expect(urls.join(" ")).not.toMatch(/\/v\d+\.\d+\//);
  });
});
