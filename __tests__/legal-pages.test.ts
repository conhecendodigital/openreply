/**
 * Páginas legais (06/10/2026, revisão do app da Meta): todo texto tem
 * tradução, os dados da empresa vêm de um lugar só e o texto não cita mais
 * fornecedores que não usamos (Vercel, Railway, GitHub, "Open-Source Core").
 */
import { describe, expect, it } from "vitest";
import { pt } from "../lib/i18n/pt";
import { translate } from "../lib/i18n";
import { LEGAL_PAGES } from "../lib/legal-pages";
import { LEGAL_INFO, legalInfoPending, legalVars } from "../lib/legal-info";

function strings(): string[] {
  const out: string[] = [];
  for (const page of Object.values(LEGAL_PAGES)) {
    out.push(page.metaTitle, page.metaDescription, page.title, page.description);
    for (const s of page.sections) out.push(s.heading, ...s.paragraphs, ...(s.items ?? []));
  }
  return out;
}

describe("legal pages", () => {
  it("every string has a Portuguese translation that keeps the placeholders", () => {
    const missing = strings().filter((s) => !(s in pt));
    expect(missing).toEqual([]);
    for (const s of strings()) {
      const placeholders = (s.match(/\{\w+\}/g) ?? []).sort();
      expect((pt[s].match(/\{\w+\}/g) ?? []).sort(), s).toEqual(placeholders);
    }
  });

  it("no dashes, no old providers, no open source section", () => {
    for (const s of strings()) {
      for (const text of [s, pt[s]]) {
        expect(text, s).not.toMatch(/[–—]/);
        expect(text, s).not.toMatch(/Vercel|Railway|GitHub|Open-Source|MIT license/i);
      }
    }
  });

  it("company data comes from lib/legal-info.ts, with visible markers while pending", () => {
    expect(LEGAL_INFO.company).toBe("DESTRAVE ACADEMY LTDA");
    const who = translate("pt", LEGAL_PAGES.privacyPage.sections[0].paragraphs[0], legalVars());
    expect(who).toContain("DESTRAVE ACADEMY LTDA");
    expect(who).toContain(LEGAL_INFO.cnpj);
    expect(who).toContain(LEGAL_INFO.email);
    expect(who).not.toMatch(/\{\w+\}/);
    expect(legalInfoPending({ ...LEGAL_INFO, cnpj: "[CNPJ]" })).toBe(true);
    expect(
      legalInfoPending({ ...LEGAL_INFO, cnpj: "00.000.000/0001-00", address: "Rua X, 1", email: "a@b.com" })
    ).toBe(false);
  });

  it("the data deletion page explains both ways (in the app and on Instagram)", () => {
    const headings = LEGAL_PAGES.dataDeletionPage.sections.map((s) => translate("pt", s.heading));
    expect(headings).toContain("Caminho 1: pelo app (Excluir de verdade)");
    expect(headings).toContain("Caminho 2: pelo Instagram (remover o app)");
  });
});
