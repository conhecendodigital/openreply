/**
 * Etapa 6: zod da definição do funil (formato, ids únicos, URLs seguras,
 * limites) e a migração só aditiva.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  emptyFunnelDefinition,
  funnelDefinitionSchema,
  MAX_STEPS,
  parseFunnelDefinition,
} from "../lib/funnels/schema";
import type { FunnelDefinition } from "../lib/funnels/types";
import { newId } from "../lib/funnels/ids";
import { isValidSlug, slugify, slugCandidate } from "../lib/funnels/slug";

function minimal(): FunnelDefinition {
  return {
    schemaVersion: 1,
    settings: { theme: { mode: "light", primary: "#0095f6", background: "#ffffff", text: "#000000" } },
    steps: [
      {
        id: "s1",
        title: "Capa",
        blocks: [
          { id: "b1", type: "heading", text: "Oi" },
          {
            id: "b2",
            type: "options",
            name: "p1",
            multiple: false,
            options: [
              { id: "o1", label: "Sim" },
              { id: "o2", label: "Não" },
            ],
          },
        ],
      },
      { id: "s2", title: "Fim", blocks: [{ id: "b3", type: "button", label: "Comprar", action: { kind: "checkout", url: "https://pay.hotmart.com/X1" } }] },
    ],
  };
}

const ok = (def: unknown) => funnelDefinitionSchema.safeParse(def).success;

describe("definição: formato", () => {
  it("a definição mínima e a vazia passam", () => {
    expect(ok(minimal())).toBe(true);
    expect(ok(emptyFunnelDefinition())).toBe(true);
    const empty = emptyFunnelDefinition();
    expect(empty.steps).toHaveLength(1);
    expect(empty.settings.theme).toMatchObject({ mode: "light", primary: "#0095f6", background: "#ffffff", text: "#000000", radius: "lg" });
    expect(empty.settings.pixelConsent).toBe("banner");
  });

  it("tamanho da imagem das opções: photo e icon passam, outro valor falha", () => {
    for (const imageSize of ["photo", "icon"] as const) {
      const d = minimal();
      const b = d.steps[0].blocks[1];
      if (b.type === "options") b.imageSize = imageSize;
      expect(ok(d)).toBe(true);
    }
    const ruim = minimal() as unknown as { steps: { blocks: Record<string, unknown>[] }[] };
    ruim.steps[0].blocks[1].imageSize = "gigante";
    expect(ok(ruim)).toBe(false);
  });

  it("ids duplicados de tela, bloco, opção e name falham", () => {
    const a = minimal();
    a.steps[1].id = "s1";
    expect(ok(a)).toBe(false);
    const b = minimal();
    b.steps[1].blocks[0].id = "b1";
    expect(ok(b)).toBe(false);
    const c = minimal();
    const opts = c.steps[0].blocks[1] as Extract<FunnelDefinition["steps"][0]["blocks"][0], { type: "options" }>;
    opts.options[1].id = "o1";
    expect(ok(c)).toBe(false);
    const d = minimal();
    d.steps[1].blocks.push({ id: "b9", type: "options", name: "p1", multiple: false, options: [] });
    expect(ok(d)).toBe(false);
  });

  it("vídeo só de host permitido", () => {
    const def = minimal();
    def.steps[0].blocks.push({ id: "v1", type: "video", url: "https://youtu.be/dQw4w9WgXcQ", title: "VSL" });
    expect(ok(def)).toBe(true);
    for (const url of [
      "https://evil.com/embed/dQw4w9WgXcQ",
      '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>',
      "http://youtu.be/dQw4w9WgXcQ",
    ]) {
      const bad = minimal();
      bad.steps[0].blocks.push({ id: "v1", type: "video", url, title: "VSL" });
      expect(ok(bad), url).toBe(false);
    }
  });

  it("http: e javascript: em imagem e checkout falham", () => {
    for (const url of ["http://x.com/a.png", "javascript:alert(1)"]) {
      const img = minimal();
      img.steps[0].blocks.push({ id: "i1", type: "image", url, alt: "" });
      expect(ok(img), url).toBe(false);
      const chk = minimal();
      chk.steps[1].blocks[0] = { id: "b3", type: "button", label: "Comprar", action: { kind: "checkout", url } };
      expect(ok(chk), url).toBe(false);
      const set = minimal();
      set.settings.checkoutUrl = url;
      expect(ok(set), url).toBe(false);
    }
    const empty = minimal();
    empty.steps[1].blocks[0] = { id: "b3", type: "button", label: "Comprar", action: { kind: "checkout", url: "" } };
    expect(ok(empty)).toBe(true);
  });

  it("pixelId com letra falha; só dígitos (5 a 20) ou vazio passa", () => {
    const bad = minimal();
    bad.settings.pixelId = "12a45";
    expect(ok(bad)).toBe(false);
    const good = minimal();
    good.settings.pixelId = "123456789012345";
    expect(ok(good)).toBe(true);
    good.settings.pixelId = "";
    expect(ok(good)).toBe(true);
  });

  it("limites: 41 telas, cor fora de #RRGGBB, delay > 600 e definição gigante falham", () => {
    const many = minimal();
    many.steps = Array.from({ length: MAX_STEPS + 1 }, (_, i) => ({ id: `s${i}`, title: "t", blocks: [] }));
    expect(ok(many)).toBe(false);
    const color = minimal();
    color.settings.theme.primary = "blue";
    expect(ok(color)).toBe(false);
    const delay = minimal();
    delay.steps[0].blocks[0].delaySec = 601;
    expect(ok(delay)).toBe(false);
    const big = minimal();
    (big.steps[0].blocks[0] as { text: string }).text = "x".repeat(1999);
    for (let i = 0; i < 30; i++) big.steps.push({ id: `x${i}`, title: "t", blocks: Array.from({ length: 5 }, (_, j) => ({ id: `t${i}_${j}`, type: "text" as const, text: "y".repeat(1999) })) });
    const r = parseFunnelDefinition(big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0].code).toBe("too_big");
  });

  it("countdown só com data ISO com fuso", () => {
    const def = minimal();
    def.steps[0].blocks.push({ id: "c1", type: "countdown", deadline: "2030-01-01T10:00:00-03:00", label: "Acaba em" });
    expect(ok(def)).toBe(true);
    (def.steps[0].blocks[2] as { deadline: string }).deadline = "amanhã";
    expect(ok(def)).toBe(false);
  });

  it("parseFunnelDefinition devolve issues no erro", () => {
    const r = parseFunnelDefinition({ schemaVersion: 2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.length).toBeGreaterThan(0);
  });
});

describe("ids e endereço", () => {
  it("newId tem prefixo e 8 caracteres base36", () => {
    expect(newId("s")).toMatch(/^s_[0-9a-z]{8}$/);
    expect(newId("b")).not.toBe(newId("b"));
  });

  it("slugify tira acento, reservados e respeita 3..60", () => {
    expect(slugify("Chat Sem Frescura!")).toBe("chat-sem-frescura");
    expect(slugify("Ação é já")).toBe("acao-e-ja");
    expect(slugify("q")).toBe("q-quiz");
    expect(slugify("Preview")).toBe("preview-quiz");
    expect(slugify("a".repeat(100)).length).toBe(60);
    expect(isValidSlug("chat-sem-frescura")).toBe(true);
    expect(isValidSlug("api")).toBe(false);
    expect(isValidSlug("Chat")).toBe(false);
    expect(isValidSlug("ab")).toBe(false);
    expect(slugCandidate("chat", 2)).toBe("chat-2");
  });
});

describe("migração 20261010120000_funis", () => {
  const sql = readFileSync(join(__dirname, "../prisma/migrations/20261010120000_funis/migration.sql"), "utf8");
  it("é só aditiva", () => {
    expect(sql).not.toMatch(/DROP|ALTER COLUMN|RENAME|FlowRun_one_open/i);
    expect(sql).not.toMatch(/ALTER TABLE "(?!Funnel)/);
    expect(sql).toMatch(/CREATE TYPE "FunnelStatus"/);
    for (const t of ["Funnel", "FunnelVisit", "FunnelEvent", "FunnelLead", "FunnelPurchase"]) {
      expect(sql).toContain(`CREATE TABLE "${t}"`);
    }
    expect(sql).toContain('CREATE UNIQUE INDEX "Funnel_slug_key"');
  });
});
