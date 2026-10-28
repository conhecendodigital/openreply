/**
 * 29/10/2026: retomada do vendedor do Instagram (fluxo mandou a oferta, a pessoa não respondeu).
 * Nada rodou contra Meta/banco reais.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    vendedorIgConfig: { findMany: vi.fn(async () => [] as unknown[]), findUnique: vi.fn(async () => null as unknown) },
    vendedorIgLog: { findMany: vi.fn(async () => []) },
    instagramAccount: { findUnique: vi.fn(async () => null as unknown) },
    contact: { findMany: vi.fn(async () => [] as unknown[]) },
  },
}));
vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import { defaultConfig, validarPatch, type VendedorConfig } from "../lib/vendedor-ig/config";
import { processarConversa, type DepsVendedor } from "../lib/vendedor-ig/motor";
import { buscarCandidatosRetomada, decidirRetomada, ehAutoResposta, type BancoRetomada, type EntradaRetomada } from "../lib/vendedor-ig/retomada";
import { BLOCO_RETOMADA, sistemaVariavel, violacoesDeRetomada } from "../lib/vendedor-ig/prompt";
import { rodarVendedorIg } from "../lib/vendedor-ig/rodar";
import type { StoredMessage } from "../lib/inbox/context";

const now = new Date("2026-10-28T15:00:00Z"); // 12h em Brasília
const H = 3_600_000;
const config: VendedorConfig = { ...defaultConfig("acc", "ws"), enabled: true, retomadaEnabled: true };

beforeEach(() => vi.clearAllMocks());

describe("filtro de autorresposta de loja", () => {
  it.each([
    "Olá. Agradecemos seu contato e interesse. Esta é uma confirmação de que recebemos a sua mensagem.",
    "Obrigada pela visita!! Faremos um melhor atendimento pelo Whatsapp.",
    "Seja bem-vindo à Brazilian Beachwear",
    "Oiee!! Eu sou a atendente Malu, me chama no WhatsApp",
    "Nosso horário de funcionamento é das 9h às 18h",
    "Esta é uma mensagem automática. Em breve responderemos.",
    "Clique no link do WhatsApp: wa.me/5511999999999",
    "Logo retornaremos!",
  ])("é autorresposta: %s", (t) => expect(ehAutoResposta(t)).toBe(true));

  it.each(["Quero saber mais", "como funciona o vídeo?", "Eu uso ChatGPT pra legenda", "", null])("pessoa de verdade: %s", (t) => expect(ehAutoResposta(t)).toBe(false));
});

function entrada(over: Partial<EntradaRetomada> = {}): EntradaRetomada {
  return {
    now,
    config,
    contato: { lastInboundAt: new Date(now.getTime() - 4 * H), humanTakeover: false, humanTakeoverUntil: null, broadcastOptOutAt: null },
    ultimaNossa: { speaker: "flow", sentAt: new Date(now.getTime() - 3.5 * H) },
    ultimaDaPessoaTexto: "quero",
    temRascunhoPendente: false,
    paradoAntes: false,
    jaTeveVendedor: false,
    temTagCompra: false,
    contagens: { hora: 0, dia: 0, pessoaDia: 0, ultimoEnvioEm: null },
    retomadasNaHora: 0,
    ...over,
  };
}

describe("decidirRetomada", () => {
  it("responde quando tudo bate", () => expect(decidirRetomada(entrada()).acao).toBe("responder"));
  it("espera antes das 3 horas", () => {
    const d = decidirRetomada(entrada({ ultimaNossa: { speaker: "flow", sentAt: new Date(now.getTime() - 2 * H) } }));
    expect(d.acao).toBe("esperar");
  });
  it("respeita retomadaHoras configurada", () => {
    const d = decidirRetomada(entrada({ config: { ...config, retomadaHoras: 5 } }));
    expect(d.acao).toBe("esperar");
  });
  it("janela de 24 h fechada pula", () => {
    const d = decidirRetomada(entrada({ contato: { lastInboundAt: new Date(now.getTime() - 25 * H), humanTakeover: false, humanTakeoverUntil: null, broadcastOptOutAt: null } }));
    expect(d.acao).toBe("pular");
  });
  it("só depois do fluxo: mensagem do dono ou do vendedor não retoma", () => {
    expect(decidirRetomada(entrada({ ultimaNossa: { speaker: "owner_phone", sentAt: new Date(now.getTime() - 4 * H) } })).acao).toBe("pular");
    expect(decidirRetomada(entrada({ ultimaNossa: { speaker: "vendedor", sentAt: new Date(now.getTime() - 4 * H) } })).acao).toBe("pular");
  });
  it("uma retomada por pessoa", () => expect(decidirRetomada(entrada({ jaTeveVendedor: true })).acao).toBe("pular"));
  it("takeover, opt-out, compra e parar pulam", () => {
    expect(decidirRetomada(entrada({ contato: { lastInboundAt: new Date(now.getTime() - 4 * H), humanTakeover: true, humanTakeoverUntil: null, broadcastOptOutAt: null } })).acao).toBe("pular");
    expect(decidirRetomada(entrada({ paradoAntes: true })).acao).toBe("pular");
    expect(decidirRetomada(entrada({ temTagCompra: true })).acao).toBe("pular");
    expect(decidirRetomada(entrada({ ultimaDaPessoaTexto: "parar" })).acao).toBe("pular");
  });
  it("autorresposta de loja pula", () => {
    expect(decidirRetomada(entrada({ ultimaDaPessoaTexto: "Seja bem-vindo à Brazilian Beachwear" })).acao).toBe("pular");
  });
  it("limites: hora, dia, pessoa/dia, retomadas/hora, silêncio e fila esperam", () => {
    expect(decidirRetomada(entrada({ contagens: { hora: 12, dia: 0, pessoaDia: 0, ultimoEnvioEm: null } })).acao).toBe("esperar");
    expect(decidirRetomada(entrada({ contagens: { hora: 0, dia: 60, pessoaDia: 0, ultimoEnvioEm: null } })).acao).toBe("esperar");
    expect(decidirRetomada(entrada({ contagens: { hora: 0, dia: 0, pessoaDia: 8, ultimoEnvioEm: null } })).acao).toBe("esperar");
    expect(decidirRetomada(entrada({ retomadasNaHora: 6 })).acao).toBe("esperar");
    expect(decidirRetomada(entrada({ now: new Date("2026-10-29T03:00:00Z") })).acao).toBe("esperar"); // meia-noite em Brasília
    expect(decidirRetomada(entrada({ contagens: { hora: 0, dia: 0, pessoaDia: 0, ultimoEnvioEm: new Date(now.getTime() - 1000) } })).acao).toBe("esperar");
  });
  it("padrões novos de config", () => {
    const d = defaultConfig("a", "w");
    expect(d).toMatchObject({ retomadaEnabled: false, retomadaHoras: 3, retomadaMaxPorHora: 6 });
    expect(validarPatch({ retomadaEnabled: "sim" }).ok).toBe(false);
    expect(validarPatch({ retomadaHoras: 0 }).ok).toBe(false);
    expect(validarPatch({ retomadaEnabled: true, retomadaHoras: 3, retomadaMaxPorHora: 6 })).toEqual({ ok: true, patch: { retomadaEnabled: true, retomadaHoras: 3, retomadaMaxPorHora: 6 } });
  });
});

describe("candidatos", () => {
  const c = (id: string, inb: number, out: number) => ({ id, workspaceId: "ws", igUserId: id, username: null, name: null, notes: null, lastInboundAt: new Date(now.getTime() - inb * H), lastOutboundAt: new Date(now.getTime() - out * H) });
  it("filtra pela ordem das mensagens, vendedor já ter falado e compra", async () => {
    const db: BancoRetomada = {
      contact: { findMany: vi.fn(async () => [c("ok", 5, 4), c("pessoa_depois", 4, 5), c("ja_vendedor", 5, 4), c("comprou", 5, 4)]) },
      vendedorIgLog: { findMany: vi.fn(async () => [{ contactId: "ja_vendedor" }]) },
      contactTag: { findMany: vi.fn(async () => [{ contactId: "comprou" }]) },
    };
    const r = await buscarCandidatosRetomada(db, "acc", config, now);
    expect(r.map((x) => x.id)).toEqual(["ok"]);
    const where = (db.contact.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0] as { where: { lastInboundAt: { gte: Date }; lastOutboundAt: { lte: Date } } };
    expect(where.where.lastInboundAt.gte.getTime()).toBe(now.getTime() - 24 * H);
    expect(where.where.lastOutboundAt.lte.getTime()).toBe(now.getTime() - 3 * H);
  });
});

function msg(over: Partial<StoredMessage> & { mid: string }): StoredMessage {
  return { fromMe: true, speaker: "flow", speakerLabel: "NOSSO FLUXO (automático, não é a pessoa)", kind: "text", repeated: 1, text: "Aqui está o teste do Gemini", preview: "x", sentAt: new Date(now.getTime() - 4 * H), storyReply: false, storyKind: null, ...over } as StoredMessage;
}

function mk(over: Partial<DepsVendedor> = {}, msgs: StoredMessage[] = [msg({ mid: "f1" })], partes = ["Conseguiu abrir o teste do Gemini no celular?"]) {
  const calls = { enviar: vi.fn(), ia: vi.fn(), rascunho: vi.fn(), final: vi.fn(), reservar: vi.fn() };
  const deps: DepsVendedor = {
    agora: () => now,
    config,
    contato: async () => ({ lastInboundAt: new Date(now.getTime() - 5 * H), humanTakeover: false, humanTakeoverUntil: null, broadcastOptOutAt: null }),
    mensagens: async () => msgs,
    contagens: async () => ({ hora: 0, dia: 0, pessoaDia: 0, ultimoEnvioEm: null }),
    temRascunhoPendente: async () => false,
    paradoAntes: async () => false,
    jaFalouComVendedor: async () => false,
    temTagCompra: async () => false,
    retomadasNaHora: async () => 0,
    reservar: async (mid) => (calls.reservar(mid), "log1"),
    finalizar: async (...a) => void calls.final(...a),
    perguntarIa: async (i) => {
      calls.ia(i);
      return { texto: JSON.stringify({ partes, passar_pro_dono: false, motivo: "", confianca: 0.9 }), modelo: "m", custoMicro: 1 };
    },
    podeGastar: async () => true,
    cartao: async () => "Etiquetas: teste-gemini-video-curto",
    nomeDaPessoa: () => "Ana",
    enviar: async (p) => (calls.enviar(p), { mids: p.map((_, i) => `mid${i}`), falha: null }),
    criarRascunho: async (t, m) => (calls.rascunho(t, m), { ok: true, id: "d1" }),
    registrarParada: async () => undefined,
    chamarDono: async () => undefined,
    ...over,
  };
  return { deps, calls };
}

describe("processarConversa em modo retomada", () => {
  it("envia a continuação, com o bloco de retomada no prompt e a decisão marcada 'retomada:'", async () => {
    const { deps, calls } = mk();
    const r = await processarConversa(deps, { modo: "retomada" });
    expect(r.outcome).toBe("sent");
    expect(calls.reservar).toHaveBeenCalledWith("retomada:f1");
    expect(calls.ia.mock.calls[0][0].sistemaVariavel).toContain(BLOCO_RETOMADA);
    expect(calls.ia.mock.calls[0][0].sistemaVariavel).toContain("teste-gemini-video-curto");
    expect(calls.enviar).toHaveBeenCalledWith(["Conseguiu abrir o teste do Gemini no celular?"]);
  });
  it("modo normal não leva o bloco de retomada", () => {
    expect(sistemaVariavel("", [], null, { modo: "normal" })).not.toContain("MODO RETOMADA");
  });
  it("antes de 3 h: espera, sem reservar nem chamar a IA", async () => {
    const { deps, calls } = mk({}, [msg({ mid: "f1", sentAt: new Date(now.getTime() - 1 * H) })]);
    const r = await processarConversa(deps, { modo: "retomada" });
    expect(r.outcome).toBe("esperar");
    expect(calls.reservar).not.toHaveBeenCalled();
    expect(calls.ia).not.toHaveBeenCalled();
  });
  it("se a última é da pessoa, retomada não age", async () => {
    const { deps, calls } = mk({}, [msg({ mid: "f1" }), msg({ mid: "p1", fromMe: false, speaker: "person", speakerLabel: "A PESSOA", text: "oi" })]);
    expect((await processarConversa(deps, { modo: "retomada" })).outcome).toBe("esperar");
    expect(calls.ia).not.toHaveBeenCalled();
  });
  it("autorresposta de loja como última da pessoa: pula, sem IA nem envio", async () => {
    const { deps, calls } = mk({}, [msg({ mid: "p0", fromMe: false, speaker: "person", speakerLabel: "A PESSOA", text: "Seja bem-vindo à Brazilian Beachwear", sentAt: new Date(now.getTime() - 5 * H) }), msg({ mid: "f1" })]);
    const r = await processarConversa(deps, { modo: "retomada" });
    expect(r.outcome).toBe("skipped");
    expect(calls.ia).not.toHaveBeenCalled();
    expect(calls.enviar).not.toHaveBeenCalled();
  });
  it("vendedor já falou: pula; compra: pula", async () => {
    expect((await processarConversa(mk({ jaFalouComVendedor: async () => true }).deps, { modo: "retomada" })).outcome).toBe("skipped");
    expect((await processarConversa(mk({ temTagCompra: async () => true }).deps, { modo: "retomada" })).outcome).toBe("skipped");
  });
  it("sem os dados de segurança a retomada nem começa", async () => {
    const { deps } = mk({ jaFalouComVendedor: undefined });
    expect((await processarConversa(deps, { modo: "retomada" })).outcome).toBe("esperar");
  });
  it("preço, link ou 3 partes viram rascunho, nunca envio", async () => {
    const { deps, calls } = mk({}, undefined, ["Sai em 12x de R$ 10,03.", "Quer ver?"]);
    const r = await processarConversa(deps, { modo: "retomada" });
    expect(r.outcome).toBe("draft");
    expect(calls.enviar).not.toHaveBeenCalled();
    expect(violacoesDeRetomada("olha https://x.com", 1).length).toBe(1);
    expect(violacoesDeRetomada("tudo bem", 3).length).toBe(1);
  });
  it("confiança baixa continua virando rascunho", async () => {
    const { deps, calls } = mk({
      perguntarIa: async () => ({ texto: JSON.stringify({ partes: ["Conseguiu abrir o teste do Gemini?"], passar_pro_dono: false, motivo: "", confianca: 0.3 }), modelo: "m", custoMicro: 1 }),
    });
    expect((await processarConversa(deps, { modo: "retomada" })).outcome).toBe("draft");
    expect(calls.enviar).not.toHaveBeenCalled();
  });
  it("pessoa escreveu enquanto a IA pensava: nada enviado", async () => {
    let n = 0;
    const antes = [msg({ mid: "f1" })];
    const depois = [msg({ mid: "f1" }), msg({ mid: "p1", fromMe: false, speaker: "person", speakerLabel: "A PESSOA", text: "oi" })];
    const { deps, calls } = mk({ mensagens: async () => (n++ === 0 ? antes : depois) });
    expect((await processarConversa(deps, { modo: "retomada" })).outcome).toBe("skipped");
    expect(calls.enviar).not.toHaveBeenCalled();
  });
});

describe("rodada: interruptores", () => {
  const conta = { id: "acc", instagramId: "ig", workspaceId: "ws", accessToken: "x", workspace: { ownerId: "u" } };
  function preparar(retomadaEnabled: boolean) {
    mockPrisma.vendedorIgConfig.findMany.mockResolvedValue([{ instagramAccountId: "acc" }]);
    mockPrisma.instagramAccount.findUnique.mockResolvedValue(conta);
    mockPrisma.vendedorIgConfig.findUnique.mockResolvedValue({ ...defaultConfig("acc", "ws"), enabled: true, retomadaEnabled });
    mockPrisma.contact.findMany.mockResolvedValue([]);
  }
  it("retomada desligada: só a passada normal busca contatos", async () => {
    preparar(false);
    await rodarVendedorIg({ now });
    expect(mockPrisma.contact.findMany).toHaveBeenCalledTimes(1);
  });
  it("retomada ligada: faz a segunda passada", async () => {
    preparar(true);
    await rodarVendedorIg({ now });
    expect(mockPrisma.contact.findMany).toHaveBeenCalledTimes(2);
  });
  it("VENDEDOR_IG_DISABLED desliga também a retomada", async () => {
    preparar(true);
    process.env.VENDEDOR_IG_DISABLED = "1";
    const r = await rodarVendedorIg({ now });
    delete process.env.VENDEDOR_IG_DISABLED;
    expect(r.desligado).toBe("env");
    expect(mockPrisma.contact.findMany).not.toHaveBeenCalled();
  });
});
