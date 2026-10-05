/**
 * Etapa 6: validateFunnel. Cada código dispara no caso certo e não dispara
 * no funil limpo. Com erro não publica; aviso só avisa.
 */
import { describe, expect, it } from "vitest";
import type { FunnelBlock, FunnelDefinition, FunnelIssueCode } from "../lib/funnels/types";
import { FUNNEL_ISSUE_CODES } from "../lib/funnels/types";
import { BLOCK_TYPE_NAMES, contrastRatio, ISSUE_MESSAGES, validateFunnel } from "../lib/funnels/validate";
import { toPublicFunnel } from "../lib/funnels/render";

const NOW = new Date("2026-10-05T12:00:00Z");

function clean(): FunnelDefinition {
  return {
    schemaVersion: 1,
    settings: {
      theme: { mode: "light", primary: "#0095f6", background: "#ffffff", text: "#000000" },
      checkoutUrl: "https://pay.hotmart.com/X123",
    },
    steps: [
      {
        id: "s1",
        title: "Capa",
        blocks: [
          { id: "b1", type: "heading", text: "Descubra como usar IA" },
          { id: "b2", type: "image", url: "https://cdn.exemplo.com/capa.gif", alt: "Matheus" },
          { id: "b3", type: "button", label: "Quero", action: { kind: "next" } },
        ],
      },
      {
        id: "s2",
        title: "Pergunta",
        blocks: [
          {
            id: "b4",
            type: "options",
            name: "p1",
            multiple: false,
            options: [
              { id: "o1", label: "Sim", goto: "s3" },
              { id: "o2", label: "Não" },
            ],
          },
        ],
      },
      {
        id: "s3",
        title: "Oferta",
        blocks: [
          { id: "b5", type: "video", url: "https://youtu.be/dQw4w9WgXcQ", title: "Vídeo" },
          { id: "b6", type: "offer", priceCents: 9700, compareAtCents: 19700, guaranteeDays: 7, guaranteeText: "7 dias" },
          { id: "b7", type: "button", label: "Comprar", action: { kind: "checkout" } },
        ],
      },
    ],
  };
}

const codes = (def: FunnelDefinition) => {
  const v = validateFunnel(def, NOW);
  return [...v.errors, ...v.warnings].map((i) => i.code);
};
const levelOf = (def: FunnelDefinition, code: FunnelIssueCode) =>
  [...validateFunnel(def, NOW).errors, ...validateFunnel(def, NOW).warnings].find((i) => i.code === code)?.level;
function withBlock(stepIndex: number, block: FunnelBlock, def = clean()) {
  def.steps[stepIndex].blocks.splice(def.steps[stepIndex].blocks.length - 1, 0, block);
  return def;
}

describe("validateFunnel", () => {
  it("funil limpo: sem erro nem aviso", () => {
    expect(validateFunnel(clean(), NOW)).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it("cada código tem mensagem", () => {
    for (const code of FUNNEL_ISSUE_CODES) expect(ISSUE_MESSAGES[code], code).toBeTruthy();
    expect(Object.keys(BLOCK_TYPE_NAMES)).toHaveLength(16);
  });

  it("no_steps", () => {
    const def = clean();
    def.steps = [];
    expect(codes(def)).toContain("no_steps");
    expect(validateFunnel(def, NOW).ok).toBe(false);
  });

  it("duplicate_id e duplicate_name (defesa extra)", () => {
    const def = clean();
    def.steps[1].blocks.push({ id: "b1", type: "spacer", size: "sm" });
    def.steps[2].blocks.push({ id: "b9", type: "options", name: "p1", multiple: false, options: [{ id: "x", label: "a" }, { id: "y", label: "b" }] });
    expect(codes(def)).toEqual(expect.arrayContaining(["duplicate_id", "duplicate_name"]));
  });

  it("goto_missing (botão e opção) e route_missing", () => {
    const a = clean();
    (a.steps[0].blocks[2] as { action: unknown }).action = { kind: "goto", stepId: "sumiu" };
    expect(codes(a)).toContain("goto_missing");
    const b = clean();
    (b.steps[1].blocks[0] as { options: { goto?: string }[] }).options[0].goto = "sumiu";
    expect(codes(b)).toContain("goto_missing");
    const c = withBlock(1, { id: "l1", type: "loading", text: "Calculando", routes: [{ min: 0, stepId: "sumiu" }] });
    expect(codes(c)).toContain("route_missing");
  });

  it("two_options_blocks e options_empty", () => {
    const a = clean();
    a.steps[1].blocks.push({ id: "b8", type: "options", name: "p2", multiple: true, options: [{ id: "x", label: "a" }, { id: "y", label: "b" }] });
    expect(codes(a)).toContain("two_options_blocks");
    const b = clean();
    (b.steps[1].blocks[0] as { options: unknown[] }).options = [{ id: "o1", label: "Só uma" }];
    expect(codes(b)).toContain("options_empty");
  });

  it("dead_end: tela do meio sem saída; última tela pode não ter botão", () => {
    const a = clean();
    a.steps[0].blocks = [{ id: "b1", type: "heading", text: "Sem saída" }];
    expect(codes(a)).toContain("dead_end");
    const b = clean();
    b.steps[2].blocks = b.steps[2].blocks.filter((x) => x.type !== "button");
    expect(codes(b)).not.toContain("dead_end");
  });

  it("loading_not_last_block é aviso", () => {
    const def = clean();
    def.steps[1].blocks.unshift({ id: "l1", type: "loading", text: "Calculando" });
    expect(levelOf(def, "loading_not_last_block")).toBe("warning");
  });

  it("checkout_no_url, checkout_unknown_host e url_not_https", () => {
    const a = clean();
    delete a.settings.checkoutUrl;
    expect(codes(a)).toContain("checkout_no_url");
    const b = clean();
    b.settings.checkoutUrl = "https://minha-loja.com/comprar";
    expect(levelOf(b, "checkout_unknown_host")).toBe("warning");
    const c = clean();
    (c.steps[0].blocks[1] as { url: string }).url = "http://cdn.exemplo.com/capa.gif";
    expect(codes(c)).toContain("url_not_https");
    const d = clean();
    d.settings.logoUrl = "http://x.com/logo.png";
    expect(codes(d)).toContain("url_not_https");
  });

  it("video_not_allowed (defesa extra)", () => {
    const def = clean();
    (def.steps[2].blocks[0] as { url: string }).url = "https://evil.com/v";
    expect(codes(def)).toContain("video_not_allowed");
  });

  it("depoimento e antes e depois precisam de autorização", () => {
    const a = withBlock(0, { id: "t1", type: "testimonial", quote: "Mudou tudo", author: "Ana", authorized: false });
    expect(codes(a)).toContain("testimonial_not_authorized");
    const ok = withBlock(0, { id: "t1", type: "testimonial", quote: "Mudou tudo", author: "Ana", authorized: true });
    expect(codes(ok)).not.toContain("testimonial_not_authorized");
    const b = withBlock(0, {
      id: "c1",
      type: "compare",
      before: { title: "Antes", imageUrl: "https://cdn.x.com/a.png", items: [] },
      after: { title: "Depois", items: [] },
    });
    expect(codes(b)).toContain("compare_not_authorized");
    const noImg = withBlock(0, { id: "c1", type: "compare", before: { title: "Antes", items: ["a"] }, after: { title: "Depois", items: ["b"] } });
    expect(codes(noImg)).not.toContain("compare_not_authorized");
  });

  it("oferta: sem preço, 'de' não maior, garantia sem dias", () => {
    const a = clean();
    (a.steps[2].blocks[1] as { priceCents: number | null }).priceCents = null;
    expect(codes(a)).toContain("offer_no_price");
    const b = clean();
    (b.steps[2].blocks[1] as { compareAtCents: number }).compareAtCents = 9700;
    expect(codes(b)).toContain("offer_compare_not_higher");
    const c = clean();
    (c.steps[2].blocks[1] as { guaranteeDays: number | null }).guaranteeDays = null;
    expect(codes(c)).toContain("guarantee_no_days");
  });

  it("contador: inválido = erro, vencido = aviso", () => {
    const a = withBlock(2, { id: "k1", type: "countdown", deadline: "não é data", label: "Acaba" });
    expect(levelOf(a, "countdown_invalid")).toBe("error");
    const b = withBlock(2, { id: "k1", type: "countdown", deadline: "2026-10-01T10:00:00-03:00", label: "Acaba" });
    expect(levelOf(b, "countdown_past")).toBe("warning");
    const c = withBlock(2, { id: "k1", type: "countdown", deadline: "2026-12-01T10:00:00-03:00", label: "Acaba" });
    expect(codes(c)).not.toContain("countdown_past");
  });

  it("placeholder_left: colchete, imagem .invalid e vídeo XXXXXXXXXXX", () => {
    const a = clean();
    (a.steps[0].blocks[0] as { text: string }).text = "Descubra [resultado]";
    const issue = validateFunnel(a, NOW).errors.find((i) => i.code === "placeholder_left");
    expect(issue).toMatchObject({ stepId: "s1", blockId: "b1", params: { text: "[resultado]" } });
    const b = clean();
    (b.steps[0].blocks[1] as { url: string }).url = "https://troque.invalid/capa.jpg";
    expect(codes(b)).toContain("placeholder_left");
    const c = clean();
    (c.steps[2].blocks[0] as { url: string }).url = "https://www.youtube.com/watch?v=XXXXXXXXXXX";
    expect(codes(c)).toContain("placeholder_left");
    const d = clean();
    d.settings.consentText = "Concordo com [empresa]";
    expect(codes(d)).toContain("placeholder_left");
  });

  it("fields_without_privacy e last_step_no_checkout são avisos", () => {
    const a = withBlock(2, { id: "f1", type: "field", field: "email", label: "Seu e-mail" });
    expect(levelOf(a, "fields_without_privacy")).toBe("warning");
    a.settings.privacyUrl = "/privacy";
    expect(codes(a)).not.toContain("fields_without_privacy");
    const b = clean();
    b.steps[2].blocks = b.steps[2].blocks.filter((x) => x.type !== "button");
    expect(levelOf(b, "last_step_no_checkout")).toBe("warning");
  });

  it("low_contrast e pixel_invalid", () => {
    const a = clean();
    a.settings.theme.text = "#dddddd";
    expect(levelOf(a, "low_contrast")).toBe("warning");
    const b = clean();
    b.settings.theme.primary = "#ffff00";
    expect(codes(b)).toContain("low_contrast");
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
    const c = clean();
    c.settings.pixelId = "abc";
    expect(codes(c)).toContain("pixel_invalid");
  });
});

describe("toPublicFunnel", () => {
  it("monta embed, checkout final, tira depoimento sem autorização e contador vencido", () => {
    const def = clean();
    def.steps[2].blocks.push(
      { id: "t1", type: "testimonial", quote: "q", author: "a", authorized: false },
      { id: "k1", type: "countdown", deadline: "2026-10-01T10:00:00-03:00", label: "x" },
      { id: "k2", type: "countdown", deadline: "2026-12-01T10:00:00-03:00", label: "y" }
    );
    const pub = toPublicFunnel({ id: "f1", slug: "chat", name: "Chat", version: 3, definition: def }, NOW);
    const blocks = pub.steps[2].blocks;
    expect(blocks.find((b) => b.id === "b5")).toMatchObject({ provider: "youtube", embedUrl: expect.stringContaining("youtube-nocookie.com/embed/dQw4w9WgXcQ") });
    expect(blocks.find((b) => b.id === "b7")).toMatchObject({ checkoutUrl: "https://pay.hotmart.com/X123" });
    expect(blocks.some((b) => b.id === "t1" || b.id === "k1")).toBe(false);
    expect(blocks.some((b) => b.id === "k2")).toBe(true);
    expect(pub.settings.privacyUrl).toBe("/privacy");
    expect(pub.settings.consentText).toContain("Concordo");
    expect(pub.version).toBe(3);
  });
});
