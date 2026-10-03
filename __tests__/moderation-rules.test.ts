import { describe, expect, it } from "vitest";
import {
  classify,
  cleanTerms,
  containsTerm,
  DEFAULT_CATEGORIES,
  findAllowedTerm,
  findLink,
  findPhone,
  normalize,
} from "../lib/moderation/rules";

const defaults = { categories: [...DEFAULT_CATEGORIES], blockedTerms: [], allowedTerms: [] };
const all = { ...defaults, categories: ["spam_link", "scam", "politics", "offense"] };

describe("normalize / containsTerm", () => {
  it("drops accents and case", () => {
    expect(normalize("  ELEIÇÃO  Já ")).toBe("eleicao ja");
  });

  it("matches whole words and phrases only", () => {
    expect(containsTerm(normalize("manda o PIX caindo agora"), "pix caindo")).toBe(true);
    expect(containsTerm(normalize("adorei o pixel"), "pix")).toBe(false);
    expect(containsTerm(normalize("Ganhe R$500 hoje"), "ganhe r$")).toBe(true);
    expect(containsTerm(normalize("não é idiotice"), "idiota")).toBe(false);
  });
});

describe("links and phones", () => {
  it("finds scheme links, www and shorteners", () => {
    expect(findLink("olha https://golpe.xyz/abc")).toContain("https://golpe.xyz");
    expect(findLink("entra em www.site.com.br")).toContain("www.site.com.br");
    expect(findLink("chama no wa.me/5511999999999")).toBe("wa.me");
    expect(findLink("BIT.LY/promo")).toBe("BIT.LY");
  });

  it("finds bare lowercase domains but not a missing space after a period", () => {
    expect(findLink("acessa meusite.com agora")).toBe("meusite.com");
    expect(findLink("gostei muito do ban.Shop")).toBeNull();
    expect(findLink("Top demais.Info pra mim")).toBeNull();
  });

  it("does not see a link in ordinary text or an email-like @", () => {
    expect(findLink("quero o comando, por favor")).toBeNull();
    expect(findLink("valeu.")).toBeNull();
  });

  it("finds Brazilian phones with or without +55", () => {
    expect(findPhone("me chama +55 11 98765-4321")).not.toBeNull();
    expect(findPhone("zap (11) 98765-4321")).not.toBeNull();
    expect(findPhone("11987654321")).not.toBeNull();
  });

  it("does not take prices or short numbers for phones", () => {
    expect(findPhone("paguei R$ 297 no curso")).toBeNull();
    expect(findPhone("são 425 mil seguidores")).toBeNull();
  });
});

describe("classify", () => {
  it("leaves normal comments alone", () => {
    expect(classify("FOTO", defaults).verdict).toBe("ok");
    expect(classify("Quero o comando! Aceita pix?", defaults).verdict).toBe("ok");
    expect(classify("fui vítima de hacker, como me protejo?", defaults).verdict).toBe("ok");
    expect(classify("", defaults).verdict).toBe("ok");
  });

  it("flags spam and links", () => {
    expect(classify("segue de volta 🙏", defaults)).toMatchObject({ verdict: "spam_link" });
    expect(classify("visita meu perfil", defaults).verdict).toBe("spam_link");
    expect(classify("compra aqui https://x.co/a", defaults)).toMatchObject({
      verdict: "spam_link",
      matchedRule: "link",
    });
    expect(classify("chama 11 98765-4321", defaults)).toMatchObject({
      verdict: "spam_link",
      matchedRule: "phone",
    });
  });

  it("flags scams in Portuguese, with or without accents", () => {
    expect(classify("Renda extra garantida, me chama", defaults).verdict).toBe("scam");
    expect(classify("RECUPERO CONTA hackeada", defaults).verdict).toBe("scam");
    expect(classify("ganhei no pix com o tigrinho", defaults).verdict).toBe("scam");
    expect(classify("opções binárias é o futuro", defaults).verdict).toBe("scam");
  });

  it("flags offenses", () => {
    expect(classify("seu idiota", defaults).verdict).toBe("offense");
    expect(classify("VTNC", defaults).verdict).toBe("offense");
  });

  it("only flags politics when that category is on", () => {
    expect(classify("fora Bolsonaro", defaults).verdict).toBe("ok");
    expect(classify("fora Bolsonaro", all).verdict).toBe("politics");
    expect(classify("Eleição de 2026", all).verdict).toBe("politics");
    // "PT"/"direita" alone are deliberately not in the list.
    expect(classify("moro em PT, vira à direita", all).verdict).toBe("ok");
  });

  it("respects turned-off categories", () => {
    expect(classify("segue de volta", { ...defaults, categories: ["scam"] }).verdict).toBe("ok");
  });

  it("puts the owner's blocked terms first", () => {
    const res = classify("compre no concorrente", { ...defaults, blockedTerms: ["concorrente"] });
    expect(res).toMatchObject({ verdict: "blocked_term", matchedRule: "concorrente" });
    expect(res.reason).toContain("concorrente");
  });
});

describe("allowed terms and cleanup", () => {
  it("finds allowed terms ignoring accents", () => {
    expect(findAllowedTerm("Quero os COMANDOS, segue de volta", ["comandos"])).toBe("comandos");
    expect(findAllowedTerm("nada aqui", ["comandos"])).toBeNull();
  });

  it("cleans, dedupes and caps lists", () => {
    expect(cleanTerms(["  pix  caindo ", "Pix caindo", "", 3, "ok"])).toEqual(["pix caindo", "ok"]);
    expect(cleanTerms(Array.from({ length: 300 }, (_, i) => `t${i}`))).toHaveLength(200);
    expect(cleanTerms("nope")).toEqual([]);
  });
});
