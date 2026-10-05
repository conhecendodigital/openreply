import { describe, expect, it } from "vitest";
import { pt } from "../lib/i18n/pt";
import { ptPublic } from "../lib/i18n/pt-public";
import { ptEscala } from "../lib/i18n/pt-escala";
import { ptSite } from "../lib/i18n/pt-site";
import { translate } from "../lib/i18n";
import { CAMPAIGN_TEMPLATES } from "../lib/templates/campaign-templates";
import {
  agenciesSeoPage,
  commentLinkSeoPage,
  manychatAlternativePage,
  templatesSeoPage,
} from "../lib/seo-pages";

/** Textos que ficam iguais nas duas línguas (palavras-chave e exemplos). */
const SAME_IN_BOTH = new Set(["LINK", "WEBINAR", "MENU", "KIT", "ManyChat"]);

function collect(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collect(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collect(v, out));
  return out;
}

const seoPages = { manychatAlternativePage, templatesSeoPage, agenciesSeoPage, commentLinkSeoPage };

describe("public pages in Portuguese", () => {
  it("translates every visible SEO page string", () => {
    for (const [name, config] of Object.entries(seoPages)) {
      const strings = collect(config).filter((s) => !s.startsWith("/"));
      const missing = strings.filter((s) => !SAME_IN_BOTH.has(s) && !(s in pt));
      expect(missing, name).toEqual([]);
    }
  });

  it("translates every template string shown on /templates", () => {
    for (const template of CAMPAIGN_TEMPLATES) {
      const visible = {
        title: template.title,
        category: template.category,
        audience: template.audience,
        summary: template.summary,
        goal: template.goal,
        keywords: template.keywords,
        dmMessage: template.dmMessage,
        triggerExample: template.triggerExample,
        privateReplyPreview: template.privateReplyPreview,
        outcome: template.outcome,
        bestFor: template.bestFor,
        playbook: template.playbook,
        metrics: template.metrics,
      };
      const missing = collect(visible).filter((s) => !SAME_IN_BOTH.has(s) && !(s in pt));
      expect(missing, template.slug).toEqual([]);
    }
  });

  it("keeps the {username} placeholder in translated DM messages", () => {
    for (const template of CAMPAIGN_TEMPLATES) {
      expect(translate("pt", template.dmMessage)).toContain("{username}");
    }
  });

  it("follows the writing rules: no dashes and no 'prompt'", () => {
    for (const [key, value] of Object.entries(ptPublic)) {
      expect(value, key).not.toMatch(/[–—]/);
      expect(value.toLowerCase(), key).not.toContain("prompt");
    }
  });

  it("does not change a translation the panel or the home page already use", () => {
    // ptPublic is spread after ptEscala and ptSite, and before the main keys.
    const changed = Object.entries(ptPublic).filter(
      ([key, value]) =>
        pt[key] !== value ||
        (key in ptEscala && ptEscala[key] !== value) ||
        (key in ptSite && ptSite[key] !== value)
    );
    expect(changed).toEqual([]);
  });
});
