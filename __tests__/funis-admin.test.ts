import { describe, expect, it } from "vitest";
import { biggestLeak, buildStages, sumQuizzes } from "../lib/admin-funnels/board";
import { FUNNEL_TEMPLATES } from "../lib/admin-funnels/templates";
import { adminSection } from "../components/sidebar";

describe("Aba Funis (só admin)", () => {
  it("aparece no grupo do admin e some pra quem não é", () => {
    expect(adminSection("admin")?.items.map((i) => i.href)).toEqual(["/admin", "/funis"]);
    expect(adminSection("needs_2fa")?.items.map((i) => i.href)).toEqual(["/account/two-factor"]);
    expect(adminSection(null)).toBeNull();
  });

  it("monta as etapas com a % da anterior e acha o maior vazamento", () => {
    const q = sumQuizzes([
      { visits: 952, completed: 463, checkouts: 39, purchases: 0 },
      { visits: 7, completed: 0, checkouts: 0, purchases: 0 },
    ]);
    const stages = buildStages({ commented: 3882, received: 3460, clicked: 1142, ...q });
    expect(stages.map((s) => s.count)).toEqual([3882, 3460, 1142, 959, 463, 39, 0]);
    expect(stages[0].rateFromPrev).toBeNull();
    expect(stages[1].rateFromPrev).toBe(89.1);
    expect(stages[5].rateFromPrev).toBe(8.4);
    expect(biggestLeak(stages)?.key).toBe("purchases");
  });

  it("sem gente não divide por zero", () => {
    const stages = buildStages({ commented: 0, received: 0, clicked: 0, quizVisits: 0, offerViews: 0, checkouts: 0, purchases: 0 });
    expect(stages.every((s) => s.rateFromPrev === null)).toBe(true);
    expect(biggestLeak(stages)).toBeNull();
  });

  it("modelos têm texto nos dois idiomas, sem travessão, e links internos", () => {
    for (const m of FUNNEL_TEMPLATES) {
      const texts = [m.name, m.goal, m.fits, m.watch, ...m.steps.flatMap((s) => [s.title, s.detail, ...(s.tool ? [s.tool.label] : [])])];
      for (const x of texts) {
        expect(x.pt.length).toBeGreaterThan(0);
        expect(x.en.length).toBeGreaterThan(0);
        expect(x.pt).not.toMatch(/[—–]/);
      }
      for (const s of m.steps) if (s.tool) expect(s.tool.href.startsWith("/")).toBe(true);
    }
  });
});

import { FUNNEL_MAPS } from "../lib/admin-funnels/maps";

describe("Mapas de funil", () => {
  it("cada seta liga blocos que existem, ids únicos, texto nos dois idiomas", () => {
    const keys = ["commented", "received", "clicked", "quizVisits", "offerViews", "checkouts", "purchases"];
    expect(new Set(FUNNEL_MAPS.map((m) => m.id)).size).toBe(FUNNEL_MAPS.length);
    for (const m of FUNNEL_MAPS) {
      const ids = m.nodes.map((n) => n.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const e of m.edges) {
        expect(ids).toContain(e.from);
        expect(ids).toContain(e.to);
      }
      for (const n of m.nodes) {
        expect(n.label.pt.length).toBeGreaterThan(0);
        expect(n.label.en.length).toBeGreaterThan(0);
        expect(n.label.pt).not.toMatch(/[—–]/);
        if (n.metric) expect(keys).toContain(n.metric);
      }
    }
  });

  it("o primeiro mapa é o funil real, com número nos blocos principais", () => {
    expect(FUNNEL_MAPS[0].id).toBe("hoje");
    expect(FUNNEL_MAPS[0].nodes.filter((n) => n.metric).length).toBeGreaterThanOrEqual(4);
  });
});
