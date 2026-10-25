import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { DEFAULT_ACCOUNT_ORDER, FACEBOOK_PAGE_NOT_INSTAGRAM, pickDefaultInstagramAccount } from "@/lib/instagram-accounts";

// Ordered by connectedAt desc, like every caller passes them.
const pagina = { id: "fb", platform: "FACEBOOK", status: "ACTIVE" };
const insta = { id: "ig", platform: "INSTAGRAM", status: "ACTIVE" };
const instaOff = { id: "ig-off", platform: "INSTAGRAM", status: "NEEDS_RECONNECT" };
const instaAntigo = { id: "ig-old", platform: null, status: "ACTIVE" };

describe("conta padrão (25/10/2026)", () => {
  it("Página do Facebook conectada por último não vira padrão", () => {
    expect(pickDefaultInstagramAccount([pagina, insta])?.id).toBe("ig");
  });

  it("Instagram fora do ar ainda vence a Página", () => {
    expect(pickDefaultInstagramAccount([pagina, instaOff])?.id).toBe("ig-off");
  });

  it("Instagram ativo vence Instagram fora do ar", () => {
    expect(pickDefaultInstagramAccount([instaOff, pagina, insta])?.id).toBe("ig");
  });

  it("conta antiga sem platform conta como Instagram", () => {
    expect(pickDefaultInstagramAccount([pagina, instaAntigo])?.id).toBe("ig-old");
  });

  it("sem Instagram cai na Página; sem nada, null", () => {
    expect(pickDefaultInstagramAccount([pagina])?.id).toBe("fb");
    expect(pickDefaultInstagramAccount([])).toBeNull();
  });

  it("as rotas de posts, overview, perfil e stories só aceitam Instagram", () => {
    for (const r of ["posts", "overview", "profile", "stories"]) {
      const src = readFileSync(join(__dirname, "..", "app", "api", "instagram", r, "route.ts"), "utf8");
      expect(src, r).toMatch(/instagramOnly:\s*true/);
    }
    expect(FACEBOOK_PAGE_NOT_INSTAGRAM).toMatch(/Página do Facebook/);
  });

  it("a ordem do banco segue a mesma preferência (Instagram primeiro)", () => {
    expect(DEFAULT_ACCOUNT_ORDER[0]).toEqual({ platform: "desc" });
    expect(["FACEBOOK", "INSTAGRAM"].sort().reverse()[0]).toBe("INSTAGRAM");
    for (const f of ["lib/instagram-accounts.ts", "app/api/dashboard/stats/route.ts", "app/api/automations/route.ts"]) {
      expect(readFileSync(join(__dirname, "..", f), "utf8"), f).toMatch(/orderBy: DEFAULT_ACCOUNT_ORDER/);
    }
  });
});
