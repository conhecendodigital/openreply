import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeLang, translate } from "../lib/i18n";
import { pt } from "../lib/i18n/pt";

// Técnicos que ficam iguais nos dois idiomas.
const TECNICOS = new Set(["{link}", "{username}", "dm_message", "opening_dm", "opening_dm_button", "public_reply",
  "tracked_url", "ENCRYPTION_KEY", "docs/setup.md", "yc", "Lead Engine", "CSV"]);

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === "generated" || n === "node_modules") return [];
    return statSync(p).isDirectory() ? arquivos(p) : p.endsWith(".tsx") ? [p] : [];
  });
}

describe("i18n", () => {
  it("defaults to Portuguese and falls back to the English text", () => {
    expect(normalizeLang(undefined)).toBe("pt");
    expect(normalizeLang("en")).toBe("en");
    expect(translate("pt", "Campaigns")).toBe("Campanhas");
    expect(translate("en", "Campaigns")).toBe("Campaigns");
    expect(translate("pt", "Texto que ninguém traduziu")).toBe("Texto que ninguém traduziu");
    expect(translate("pt", "{n} accounts", { n: 3 })).toBe("3 contas");
  });

  it("has a Portuguese translation for every text the screens pass to t()", () => {
    const faltam = new Set<string>();
    for (const f of [...arquivos("app"), ...arquivos("components")]) {
      for (const m of readFileSync(f, "utf8").matchAll(/\b(?:t|tr)\(("(?:[^"\\]|\\.)*")/g)) {
        const k = JSON.parse(m[1]) as string;
        if (!TECNICOS.has(k) && !(k in pt)) faltam.add(k);
      }
    }
    expect([...faltam]).toEqual([]);
  });
});
