/**
 * 29/10/2026: ficha do lead, pergunta final obrigatória, lições, exemplos e anti-repetição do vendedor do Instagram.
 * Nada rodou contra Meta, IA ou banco reais.
 */
import { describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: { vendedorIgConfig: { findMany: vi.fn(async () => []) } } }));
vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import { defaultConfig, validarPatch, type VendedorConfig } from "../lib/vendedor-ig/config";
import { processarConversa, type DepsVendedor } from "../lib/vendedor-ig/motor";
import { sistemaFixo, sistemaVariavel, lerSaidaVendedor } from "../lib/vendedor-ig/prompt";
import { aplicarEdicaoDoDono, avancarEstagio, comSeguidores, estagioEfetivo, fichaParaCartao, fichaVazia, mesclar, validarExtracao, type Campo, type Ficha, type Fonte } from "../lib/vendedor-ig/ficha";
import { DEFAULT_LICOES, aberturaDe, exemplosDoPrompt, montarExemplo, problemasDaResposta, repetiuAbertura, terminaComPergunta } from "../lib/vendedor-ig/conversa";
import type { StoredMessage } from "../lib/inbox/context";

const now = new Date("2026-10-29T15:00:00Z");
const config: VendedorConfig = { ...defaultConfig("acc", "ws"), enabled: true };

function msg(over: Partial<StoredMessage> & { mid: string }): StoredMessage {
  return { fromMe: false, speaker: "person", speakerLabel: "A PESSOA", kind: "text", repeated: 1, text: "oi", preview: "oi", sentAt: new Date(now.getTime() - 5 * 60_000), storyReply: false, storyKind: null, ...over } as StoredMessage;
}
const fontes: Fonte[] = [{ origem: "dito_pela_pessoa", texto: "Eu vendo maquiagem aqui em Curitiba, tenho loja online" }, { origem: "comentario", texto: "quero aprender a fazer vídeo" }];
const campo = (valor: string, origem: Campo["origem"]): Campo => ({ valor, origem, em: now.toISOString() });

describe("ficha só com evidência", () => {
  it("aceita campo com trecho literal (sem acento/caixa) e marca a origem da fonte", () => {
    const r = validarExtracao({ negocio: { valor: "maquiagem", evidencia: "EU VENDO maquiagem" }, dor: { valor: "fazer vídeo", evidencia: "quero aprender a fazer video" } }, fontes, now);
    expect(r.negocio?.origem).toBe("dito_pela_pessoa");
    expect(r.dor?.origem).toBe("comentario");
  });
  it("descarta sem evidência, com evidência inventada, curta ou sensível", () => {
    const r = validarExtracao(
      {
        negocio: { valor: "maquiagem" },
        local: { valor: "São Paulo", evidencia: "moro em São Paulo" },
        oQueFaz: { valor: "x", evidencia: "eu" },
        objetivo: { valor: "tem depressão", evidencia: "Eu vendo maquiagem" },
        dor: { valor: "cpf 123.456.789-09", evidencia: "tenho loja online" },
      },
      fontes,
      now
    );
    expect(r).toEqual({});
  });
  it("entrada que não é objeto vira vazio", () => {
    expect(validarExtracao("oi", fontes, now)).toEqual({});
    expect(validarExtracao(null, fontes, now)).toEqual({});
  });
});

describe("merge", () => {
  it("não sobrescreve campo do dono e não apaga", () => {
    const f: Ficha = { campos: { negocio: campo("adega", "dono"), local: campo("Curitiba", "dito_pela_pessoa") }, estagio: "entendendo" };
    const m = mesclar(f, { negocio: campo("maquiagem", "dito_pela_pessoa") });
    expect(m.campos.negocio?.valor).toBe("adega");
    expect(m.campos.local?.valor).toBe("Curitiba");
  });
  it("objeções se acumulam; igual não duplica", () => {
    let f = mesclar(fichaVazia(), { objecoes: campo("tá caro", "dito_pela_pessoa") });
    f = mesclar(f, { objecoes: campo("sem tempo", "dito_pela_pessoa") });
    f = mesclar(f, { objecoes: campo("sem tempo", "dito_pela_pessoa") });
    expect(f.campos.objecoes?.valor).toBe("tá caro; sem tempo");
  });
  it("seguidores oficiais entram com origem perfil_oficial, mas não sobrescrevem o dono", () => {
    expect(comSeguidores(fichaVazia(), 1200, now).campos.seguidores).toMatchObject({ valor: "1200", origem: "perfil_oficial" });
    const d: Ficha = { campos: { seguidores: campo("5000", "dono") }, estagio: "novo" };
    expect(comSeguidores(d, 1200, now).campos.seguidores?.valor).toBe("5000");
  });
  it("edição do dono vira origem dono e vazio remove", () => {
    const f = aplicarEdicaoDoDono({ campos: { negocio: campo("x", "dito_pela_pessoa"), dor: campo("y", "quiz") }, estagio: "novo" }, { campos: { negocio: "adega", dor: null }, estagio: "comprou" }, now);
    expect(f.campos.negocio).toMatchObject({ valor: "adega", origem: "dono" });
    expect(f.campos.dor).toBeUndefined();
    expect(f.estagio).toBe("comprou");
  });
});

describe("estágio", () => {
  it("só avança na linha do funil e sumiu é derivado", () => {
    expect(avancarEstagio("novo", "entendendo")).toBe("entendendo");
    expect(avancarEstagio("viu_valor", "entendendo")).toBe("viu_valor");
    expect(avancarEstagio("novo", "comprou")).toBe("novo");
    const f: Ficha = { campos: {}, estagio: "recebeu_link" };
    expect(estagioEfetivo(f, new Date(now.getTime() - 72 * 3_600_000), now)).toBe("sumiu");
    expect(estagioEfetivo(f, new Date(now.getTime() - 3_600_000), now)).toBe("recebeu_link");
  });
});

describe("pergunta final e abertura", () => {
  it("detecta pergunta final", () => {
    expect(terminaComPergunta(["Legal.", "Você vende pelo Instagram?"])).toBe(true);
    expect(terminaComPergunta(["Você vende pelo Instagram? 🙂"])).toBe(true);
    expect(terminaComPergunta(["Legal, bora."])).toBe(false);
    expect(terminaComPergunta(["Você vende? Legal."])).toBe(false);
  });
  it("duas perguntas e abertura repetida são problemas", () => {
    expect(problemasDaResposta(["Quer ver? Ou prefere depois?"], [])).toHaveLength(1);
    expect(problemasDaResposta(["Opa, tudo bem?"], [])).toEqual([]);
    expect(repetiuAbertura(["Opa, tudo bem por aí?", "Me conta?"], ["opa tudo bem por ai?"])).toBe(true);
    expect(problemasDaResposta(["Opa, tudo bem por aí?"], ["Opa, tudo bem por aí?"])).toHaveLength(1);
  });
  it("aberturaDe pega a primeira parte", () => {
    expect(aberturaDe("Oi!\n\nSegunda")).toBe("Oi!");
  });
});

describe("prompt", () => {
  it("lições (padrão e do dono) e regras novas entram no sistema fixo", () => {
    expect(sistemaFixo(config)).toContain(DEFAULT_LICOES.slice(0, 40));
    expect(sistemaFixo({ ...config, licoes: "Nunca falar de futebol." })).toContain("Nunca falar de futebol.");
    expect(sistemaFixo(config)).toContain("TODA resposta termina com UMA pergunta");
    expect(sistemaFixo(config)).toContain("ficha_atualizada");
  });
  it("ficha, aberturas e exemplos entram no variável", () => {
    const f: Ficha = { campos: { negocio: campo("maquiagem", "dito_pela_pessoa") }, estagio: "entendendo" };
    const v = sistemaVariavel("", [msg({ mid: "1" })], null, { ficha: fichaParaCartao(f), aberturas: ["Opa, tudo bem?"], exemplos: [{ pergunta: "quanto custa", rascunho: "R$97", resposta: "É R$97, quer ver como funciona?" }] });
    expect(v).toContain("Negócio/nicho: maquiagem (origem: dito_pela_pessoa)");
    expect(v).toContain("Ainda falta saber");
    expect(v).toContain("não repita estas");
    expect(v).toContain("referência de jeito, nunca regra");
  });
  it("validarPatch aceita lições até 2000", () => {
    expect(validarPatch({ licoes: "a".repeat(2000) }).ok).toBe(true);
    expect(validarPatch({ licoes: "a".repeat(2001) }).ok).toBe(false);
  });
  it("lerSaidaVendedor traz a ficha bruta e o estágio", () => {
    const s = lerSaidaVendedor('{"partes":["a?"],"confianca":1,"estagio":"viu_valor","ficha_atualizada":{"negocio":{"valor":"x","evidencia":"y"}}}');
    expect(s?.estagio).toBe("viu_valor");
    expect(s?.fichaBruta).toBeTruthy();
  });
});

describe("exemplos", () => {
  it("anonimiza e ignora quando nada mudou", () => {
    const ex = montarExemplo({ pergunta: "oi sou a Ana, meu zap é 11 99999-1234", rascunho: "Opa Ana, tudo bem?", resposta: "Oi Ana! Você vende o quê?", nomes: ["Ana"] });
    expect(ex?.pergunta).not.toContain("99999");
    expect(ex?.pergunta).not.toContain("Ana");
    expect(montarExemplo({ pergunta: "oi tudo bem", rascunho: "Oi!", resposta: "oi!", nomes: [] })).toBeNull();
  });
  it("devolve até 3 parecidos", () => {
    const todos = Array.from({ length: 6 }, (_, i) => ({ pergunta: `quanto custa o curso de maquiagem ${i}`, rascunho: null, resposta: `resp ${i}` }));
    expect(exemplosDoPrompt(todos, "quanto custa o curso de maquiagem").length).toBe(3);
    expect(exemplosDoPrompt(todos, "tempo bom hoje")).toEqual([]);
  });
});

function mk(over: Partial<DepsVendedor> = {}, respostas: string[][] = [["Você vende o quê hoje?"]]) {
  let i = 0;
  const calls = { enviar: vi.fn(), ia: vi.fn(), rascunho: vi.fn(), final: vi.fn(), ficha: vi.fn() };
  const msgs = [msg({ mid: "m1", text: "Eu vendo maquiagem aqui em Curitiba, tenho loja online", preview: "x" })];
  const deps: DepsVendedor = {
    agora: () => now,
    config,
    contato: async () => ({ lastInboundAt: new Date(now.getTime() - 5 * 60_000), humanTakeover: false, humanTakeoverUntil: null, broadcastOptOutAt: null }),
    mensagens: async () => msgs,
    contagens: async () => ({ hora: 0, dia: 0, pessoaDia: 0, ultimoEnvioEm: null }),
    temRascunhoPendente: async () => false,
    paradoAntes: async () => false,
    reservar: async () => "log1",
    finalizar: async (...a) => void calls.final(...a),
    perguntarIa: async (inp) => {
      calls.ia(inp);
      const partes = respostas[Math.min(i++, respostas.length - 1)];
      return { texto: JSON.stringify({ partes, passar_pro_dono: false, motivo: "", confianca: 0.9, estagio: "entendendo", ficha_atualizada: { negocio: { valor: "maquiagem", evidencia: "vendo maquiagem" }, local: { valor: "Salvador", evidencia: "moro em Salvador" } } }), modelo: "m", custoMicro: 100 };
    },
    podeGastar: async () => true,
    cartao: async () => "",
    nomeDaPessoa: () => "Ana",
    enviar: async (partes) => {
      calls.enviar(partes);
      return { mids: partes.map((_, k) => `mid${k}`), falha: null };
    },
    criarRascunho: async (t, m) => {
      calls.rascunho(t, m);
      return { ok: true, id: "d1" };
    },
    registrarParada: async () => undefined,
    chamarDono: async () => undefined,
    ficha: async () => null,
    salvarFicha: async (f) => void calls.ficha(f),
    ...over,
  };
  return { deps, calls };
}

describe("motor", () => {
  it("grava só o campo com evidência (negocio) e leva estágio a entendendo", async () => {
    const { deps, calls } = mk();
    const r = await processarConversa(deps);
    expect(r.outcome).toBe("sent");
    const f = calls.ficha.mock.calls[0][0] as Ficha;
    expect(f.campos.negocio?.valor).toBe("maquiagem");
    expect(f.campos.local).toBeUndefined();
    expect(f.estagio).toBe("entendendo");
  });
  it("ficha vira contexto: a ficha salva entra no prompt da próxima rodada", async () => {
    const f: Ficha = { campos: { negocio: campo("adega", "dono") }, estagio: "entendendo" };
    const { deps, calls } = mk({ ficha: async () => f });
    await processarConversa(deps);
    expect(calls.ia.mock.calls[0][0].sistemaVariavel).toContain("Negócio/nicho: adega (origem: dono)");
  });
  it("dono não é sobrescrito pela IA no motor", async () => {
    const f: Ficha = { campos: { negocio: campo("adega", "dono") }, estagio: "entendendo" };
    const { deps, calls } = mk({ ficha: async () => f });
    await processarConversa(deps);
    expect((calls.ficha.mock.calls[0][0] as Ficha).campos.negocio?.valor).toBe("adega");
  });
  it("sem pergunta final: reescreve 1 vez e envia", async () => {
    const { deps, calls } = mk({}, [["Legal, entendi."], ["Legal, entendi.", "E hoje você divulga como?"]]);
    const r = await processarConversa(deps);
    expect(calls.ia).toHaveBeenCalledTimes(2);
    expect(calls.ia.mock.calls[1][0].mensagem).toContain("não termina com uma pergunta");
    expect(r.outcome).toBe("sent");
    expect(calls.enviar).toHaveBeenCalledWith(["Legal, entendi.", "E hoje você divulga como?"]);
  });
  it("continua sem pergunta depois da reescrita: vira rascunho, nada enviado", async () => {
    const { deps, calls } = mk({}, [["Legal."], ["Beleza."]]);
    const r = await processarConversa(deps);
    expect(calls.ia).toHaveBeenCalledTimes(2);
    expect(r.outcome).toBe("draft");
    expect(calls.enviar).not.toHaveBeenCalled();
    expect(calls.rascunho.mock.calls[0][1]).toContain("não termina com uma pergunta");
  });
  it("anti-repetição: abertura já usada é reescrita e passa ao prompt", async () => {
    const { deps, calls } = mk({ aberturasRecentes: async () => ["Opa, tudo bem por aí?"] }, [["Opa, tudo bem por aí?", "Você vende o quê?"], ["Maquiagem, que legal.", "Você vende só online?"]]);
    const r = await processarConversa(deps);
    expect(calls.ia.mock.calls[0][0].sistemaVariavel).toContain("Opa, tudo bem por aí?");
    expect(r.outcome).toBe("sent");
    expect(calls.enviar).toHaveBeenCalledWith(["Maquiagem, que legal.", "Você vende só online?"]);
  });
  it("mandar o link avança o estágio para recebeu_link", async () => {
    const { deps, calls } = mk({}, [["Aqui o link: https://pay.hotmart.com/A107839499R?off=hzpjuuco&sck=vendedor-ig", "Ficou alguma dúvida?"]]);
    const r = await processarConversa(deps);
    expect(r.outcome).toBe("sent");
    const ultimo = calls.ficha.mock.calls.at(-1)?.[0] as Ficha;
    expect(ultimo.estagio).toBe("recebeu_link");
  });
  it("falha ao salvar a ficha não atrapalha a conversa", async () => {
    const { deps } = mk({ salvarFicha: async () => { throw new Error("db"); } });
    expect((await processarConversa(deps)).outcome).toBe("sent");
  });
  it("flag desligada não envia: a rodada nem consulta o banco", async () => {
    vi.stubEnv("VENDEDOR_IG_DISABLED", "1");
    const { rodarVendedorIg } = await import("../lib/vendedor-ig/rodar");
    const r = await rodarVendedorIg();
    expect(r.desligado).toBe("env");
    expect(r.enviadas).toBe(0);
    expect(mockPrisma.vendedorIgConfig.findMany).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
  it("conta com enabled=false não é varrida", async () => {
    mockPrisma.vendedorIgConfig.findMany.mockResolvedValueOnce([]);
    const { rodarVendedorIg } = await import("../lib/vendedor-ig/rodar");
    const r = await rodarVendedorIg();
    expect(mockPrisma.vendedorIgConfig.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ enabled: true }) }));
    expect(r.enviadas).toBe(0);
  });
});
