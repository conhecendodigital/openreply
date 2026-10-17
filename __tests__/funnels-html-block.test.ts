import { describe, expect, it } from "vitest";
import { buildFrameDoc } from "../components/funnels/blocks/html";
import { funnelBlockSchema, MAX_HTML } from "../lib/funnels/schema";

describe("bloco html", () => {
  it("aceita html dentro do limite e rejeita acima dele", () => {
    const ok = funnelBlockSchema.safeParse({ id: "b1", type: "html", html: "<p>oi</p>", height: 400 });
    expect(ok.success).toBe(true);
    const big = funnelBlockSchema.safeParse({ id: "b1", type: "html", html: "x".repeat(MAX_HTML + 1) });
    expect(big.success).toBe(false);
  });

  it("monta o quadro sem rede e com links em outra aba", () => {
    const doc = buildFrameDoc("<p>oi</p>");
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain('<base target="_blank">');
    expect(doc).not.toContain("connect-src");
    expect(doc).toContain("<p>oi</p>");
  });
});
