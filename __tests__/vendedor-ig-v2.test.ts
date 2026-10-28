/**
 * 29/10/2026: vendedor v2 (regras do dono): sem apresentação, preço só no final (parcelado antes do à vista),
 * sem ligação, base de ferramentas, trava de similaridade entre leads. Nada rodou contra Meta, IA ou banco reais.
 */
import { describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: { vendedorIgConfig: { findMany: vi.fn(async () => []) } } }));
vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import { BASE_FERRAMENTAS, PRECO_OFICIAL, defaultConfig } from "../lib/vendedor-ig/config";
import { problemasDaResposta, problemasDeConteudo, repetiuTexto, similaridade } from "../lib/vendedor-ig/conversa";
import { fontesPermitidas, sistemaFixo, violacoesDeVoz } from "../lib/vendedor-ig/prompt";
import { RESPOSTA_SOU_IA, perguntouSeERobo } from "../lib/vendedor-ig/regras";
import { processarConversa, type DepsVendedor } from "../lib/vendedor-ig/motor";
import type { StoredMessage } from "../lib/inbox/context";
import { afirmacoesInventadas } from "../lib/whatsapp/agentes/guardas";

const cfg = defaultConfig("acc", "ws");

describe("prompt v2", () => {
  const s = sistemaFixo(cfg);
  it("traz as regras do dono, o preço oficial e a base de ferramentas", () => {
    expect(s).toContain("NÃO se apresente");
    expect(s).toContain("PREÇO SÓ NO FINAL");
    expect(s).toContain("NUNCA chame a pessoa nem o Matheus pra ligação");
    expect(s).toContain("NUNCA A MESMA MENSAGEM");
    expect(s).toContain(PRECO_OFICIAL);
    expect(s).toContain("nunca prometa grátis");
    expect(s).toContain("exige plano pago");
    expect(BASE_FERRAMENTAS).toContain("NUNCA prometa vídeo grátis no Gemini");
  });
  it("o nome Gil só entra na regra de identidade", () => {
    expect(s).toContain("sou o Gil, assistente da equipe do Matheus");
  });
});

describe("identidade", () => {
  it("resposta fixa usa o nome Gil e nunca nega ser assistente/IA", () => {
    expect(RESPOSTA_SOU_IA).toContain("Sou o Gil, assistente da equipe do Matheus");
    expect(RESPOSTA_SOU_IA.toLowerCase()).toContain("inteligência artificial");
    expect(RESPOSTA_SOU_IA).not.toMatch(/não sou/i);
    expect(perguntouSeERobo("você é um robô?")).toBe(true);
  });
  it("travas: apresentação, Gil e 'sou IA' espontâneos", () => {
    expect(problemasDeConteudo(["Aqui é o Gil, tudo bem?"]).join()).toContain("se apresentou");
    expect(problemasDeConteudo(["Meu nome é Gil. Você vende o quê?"]).join()).toContain("se apresentou");
    expect(problemasDeConteudo(["Eu sou uma IA que ajuda. Qual seu negócio?"]).join()).toContain("IA");
    expect(violacoesDeVoz("Oi, aqui é o Gil!").length).toBeGreaterThan(0);
    expect(problemasDeConteudo(["Eu sou o melhor nisso, o que você faz?"])).toEqual([]);
  });
});

describe("preço só no final", () => {
  it("preço cedo demais é problema; depois que a pessoa pergunta, ok", () => {
    expect(problemasDeConteudo(["Sai 12x de R$ 10,03. Quer saber mais?"], { ultimaDaPessoa: "oi, vi o reel", estagio: "novo" }).join()).toContain("preço cedo");
    expect(problemasDeConteudo(["Sai 12x de R$ 10,03. Faz sentido?"], { ultimaDaPessoa: "quanto custa?", estagio: "novo" })).toEqual([]);
    expect(problemasDeConteudo(["Sai 12x de R$ 10,03. Faz sentido?"], { ultimaDaPessoa: "hm", estagio: "viu_valor" })).toEqual([]);
  });
  it("parcelado vem antes do à vista", () => {
    expect(problemasDeConteudo(["Custa R$ 97. Quer o link?"], { ultimaDaPessoa: "quanto é?", estagio: "novo" }).join()).toContain("antes do parcelado");
    expect(problemasDeConteudo(["Custa R$ 97 no Pix. Quer o link?"], { ultimaDaPessoa: "tem no pix?", estagio: "novo" })).toEqual([]);
  });
  it("o guarda de preço inventado aceita o parcelado oficial", () => {
    const fontes = fontesPermitidas(cfg);
    expect(afirmacoesInventadas("Sai 12x de R$ 10,03 ou R$ 97 à vista.", fontes)).toEqual([]);
    expect(afirmacoesInventadas("Sai por R$ 49.", fontes).length).toBeGreaterThan(0);
  });
});

describe("compra vai direto, sem ligação", () => {
  it("chamar pra call/ligação é problema", () => {
    expect(problemasDeConteudo(["Vamos marcar uma call pra falar disso?"]).join()).toContain("ligação");
    expect(problemasDeConteudo(["Posso te ligar agora?"]).join()).toContain("ligação");
    expect(problemasDeConteudo(["Te ligo amanhã, pode ser?"]).join()).toContain("ligação");
  });
});

describe("trava de similaridade entre leads", () => {
  const enviado = "Opa, que bom que você comentou! Esse Comando de vídeo no Gemini funciona bem pra quem vende produto. O que você vende hoje?";
  it("texto quase igual ao já enviado a outra pessoa é pego", () => {
    const quase = ["Opa, que bom que você comentou! Esse Comando de vídeo no Gemini funciona bem pra quem vende produto.", "O que você vende hoje?"];
    expect(repetiuTexto(quase, [enviado])).toBe(true);
    expect(problemasDaResposta(quase, [], { textosRecentes: [enviado] }).join()).toContain("quase igual");
  });
  it("texto diferente passa", () => {
    const outro = ["Vi que você tem uma adega, então o cartaz do vinho do mês fica fácil de criar aqui.", "Você faz hoje no Canva ou pede pra alguém?"];
    expect(repetiuTexto(outro, [enviado])).toBe(false);
    expect(problemasDaResposta(outro, [], { textosRecentes: [enviado] })).toEqual([]);
  });
  it("mensagens curtinhas não disparam falso positivo", () => {
    expect(similaridade("Como assim?", "Como assim?")).toBe(0);
    expect(repetiuTexto(["Você usa IA hoje?"], ["Você usa IA hoje?"])).toBe(false);
  });
  it("mais de 3 partes é problema", () => {
    expect(problemasDaResposta(["a", "b", "c", "d?"], []).join()).toContain("mais de 3 partes");
  });
});

describe("motor: trava de similaridade e preço cedo viram rascunho", () => {
  const now = new Date("2026-10-29T15:00:00Z");
  const m1 = { mid: "m1", fromMe: false, speaker: "person", speakerLabel: "A PESSOA", kind: "text", repeated: 1, text: "oi vi o reel", preview: "oi vi o reel", sentAt: new Date(now.getTime() - 5 * 60_000), storyReply: false, storyKind: null } as unknown as StoredMessage;
  function deps(partes: string[], textosRecentes: string[]) {
    const rascunho = vi.fn();
    const enviar = vi.fn();
    const ia = vi.fn(async () => ({ texto: JSON.stringify({ partes, passar_pro_dono: false, motivo: "", confianca: 0.9 }), modelo: "x", custoMicro: 1 }));
    const d: DepsVendedor = {
      agora: () => now,
      config: { ...cfg, enabled: true },
      contato: async () => ({ lastInboundAt: new Date(now.getTime() - 5 * 60_000), humanTakeover: false, humanTakeoverUntil: null, broadcastOptOutAt: null }),
      mensagens: async () => [m1],
      contagens: async () => ({ hora: 0, dia: 0, pessoaDia: 0, ultimoEnvioEm: null }),
      temRascunhoPendente: async () => false,
      paradoAntes: async () => false,
      reservar: async () => "log",
      finalizar: async () => undefined,
      perguntarIa: ia,
      podeGastar: async () => true,
      cartao: async () => "",
      nomeDaPessoa: () => null,
      enviar: async (p) => (enviar(p), { mids: p.map((_, i) => `x${i}`), falha: null }),
      criarRascunho: async (t, mo) => (rascunho(t, mo), { ok: true as const, id: "d" }),
      registrarParada: async () => undefined,
      chamarDono: async () => undefined,
      textosRecentes: async () => textosRecentes,
    };
    return { d, rascunho, enviar, ia };
  }
  it("igual ao enviado a outro lead: reescreve 1 vez e, se continuar igual, vira rascunho", async () => {
    const igual = "Opa, que bom que você comentou! Esse Comando de vídeo no Gemini funciona bem pra quem vende produto. O que você vende hoje?";
    const { d, rascunho, enviar, ia } = deps(["Opa, que bom que você comentou! Esse Comando de vídeo no Gemini funciona bem pra quem vende produto.", "O que você vende hoje?"], [igual]);
    const r = await processarConversa(d);
    expect(r.outcome).toBe("draft");
    expect(ia).toHaveBeenCalledTimes(2);
    expect(rascunho.mock.calls[0][1]).toContain("quase igual");
    expect(enviar).not.toHaveBeenCalled();
  });
  it("texto novo e sem preço cedo é enviado", async () => {
    const { d, enviar } = deps(["Que bacana, vídeo de produto rende bastante.", "Você já tem o produto em mente?"], ["outra coisa totalmente diferente que já mandamos antes pra alguém, sem relação"]);
    const r = await processarConversa(d);
    expect(r.outcome).toBe("sent");
    expect(enviar).toHaveBeenCalled();
  });
  it("preço logo de cara (pessoa só disse 'oi') vira rascunho", async () => {
    const { d, enviar } = deps(["Sai em 12x de R$ 10,03 no cartão.", "Quer o link?"], []);
    const r = await processarConversa(d);
    expect(r.outcome).toBe("draft");
    expect(enviar).not.toHaveBeenCalled();
  });
});
