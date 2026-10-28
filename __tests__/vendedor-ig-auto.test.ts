/**
 * 28/10/2026: modo automático do vendedor do Instagram. Regras de segurança (nada rodou contra Meta/banco reais).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockPrisma, mockCaller, mockContext } = vi.hoisted(() => ({
  mockPrisma: {
    vendedorIgConfig: { findMany: vi.fn(async () => []), upsert: vi.fn(async (a: { update?: unknown } = {}) => ({ a })), findUnique: vi.fn(async () => null) },
    vendedorIgLog: { findMany: vi.fn(async () => []) },
    instagramAccount: { findFirst: vi.fn(async () => ({ id: "acc" })), findUnique: vi.fn() },
    contact: { findMany: vi.fn(async () => []) },
  },
  mockCaller: vi.fn(),
  mockContext: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ getApiCaller: mockCaller, isApiTokenRequest: vi.fn(async () => false), getCurrentWorkspaceId: vi.fn(async () => "ws") }));
vi.mock("@/lib/workspace-access", () => ({ getCurrentWorkspaceContext: mockContext, canManageWorkspace: () => true }));

import { DEFAULT_OFFER_FACTS, LINK_CHECKOUT, defaultConfig, validarPatch, vendedorDesligadoPorEnv, type VendedorConfig } from "../lib/vendedor-ig/config";
import { CONFIANCA_MINIMA, processarConversa, type DepsVendedor } from "../lib/vendedor-ig/motor";
import { assuntoSensivel, decidir, esperaDaDm, pedidoDeParar, perguntouSeERobo } from "../lib/vendedor-ig/regras";
import { lerSaidaVendedor, sistemaFixo, violacoesDeVoz } from "../lib/vendedor-ig/prompt";
import { montarCartao, perfilVencido } from "../lib/vendedor-ig/pessoa";
import { rodarVendedorIg } from "../lib/vendedor-ig/rodar";
import { ErroModelo } from "../lib/whatsapp/agentes/provedores";
import * as route from "../app/api/channels/instagram/[id]/vendedor/route";
import type { StoredMessage } from "../lib/inbox/context";

const now = new Date("2026-10-28T15:00:00Z"); // 12h em Brasília
const config: VendedorConfig = { ...defaultConfig("acc", "ws"), enabled: true };

function msg(over: Partial<StoredMessage> & { mid: string }): StoredMessage {
  return {
    fromMe: false, speaker: "person", speakerLabel: "A PESSOA", kind: "text", repeated: 1,
    text: "oi", preview: "oi", sentAt: new Date(now.getTime() - 5 * 60_000), storyReply: false, storyKind: null, ...over,
  } as StoredMessage;
}

function iaOk(partes: string[], extra: Record<string, unknown> = {}) {
  return async () => ({ texto: JSON.stringify({ partes, passar_pro_dono: false, motivo: "", confianca: 0.9, ...extra }), modelo: "claude-haiku-4-5", custoMicro: 1200 });
}

function mk(over: Partial<DepsVendedor> = {}, msgs: StoredMessage[] = [msg({ mid: "m1", text: "Quanto custa o curso?", preview: "Quanto custa o curso?" })]) {
  const calls = { enviar: vi.fn(), ia: vi.fn(), rascunho: vi.fn(), parada: vi.fn(), dono: vi.fn(), final: vi.fn() };
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
    perguntarIa: async (i) => {
      calls.ia(i);
      return iaOk(["O Chat Sem Frescura sai em 12x de R$ 10,03.", "Você usa IA hoje no seu negócio?"])();
    },
    podeGastar: async () => true,
    cartao: async () => "",
    nomeDaPessoa: () => "Ana",
    enviar: async (partes) => {
      calls.enviar(partes);
      return { mids: partes.map((_, i) => `mid${i}`), falha: null };
    },
    criarRascunho: async (t, m) => {
      calls.rascunho(t, m);
      return { ok: true, id: "d1" };
    },
    registrarParada: async (...a) => void calls.parada(...a),
    chamarDono: async (m) => void calls.dono(m),
    ...over,
  };
  return { deps, calls };
}

beforeEach(() => vi.clearAllMocks());

describe("padrão e interruptores", () => {
  it("nasce desligado", () => {
    expect(defaultConfig("a", "w").enabled).toBe(false);
  });

  it("VENDEDOR_IG_DISABLED desliga tudo, sem tocar no banco", async () => {
    expect(vendedorDesligadoPorEnv({ VENDEDOR_IG_DISABLED: "1" })).toBe(true);
    expect(vendedorDesligadoPorEnv({})).toBe(false);
    process.env.VENDEDOR_IG_DISABLED = "1";
    const r = await rodarVendedorIg({ now });
    delete process.env.VENDEDOR_IG_DISABLED;
    expect(r.desligado).toBe("env");
    expect(mockPrisma.vendedorIgConfig.findMany).not.toHaveBeenCalled();
  });

  it("sem nenhuma conta ligada, a rodada não faz nada", async () => {
    const r = await rodarVendedorIg({ now });
    expect(r).toMatchObject({ contas: 0, enviadas: 0 });
    expect(mockPrisma.contact.findMany).not.toHaveBeenCalled();
  });

  it("só o dono liga: a chave de API leva 403 e nada é gravado", async () => {
    mockCaller.mockResolvedValue({ kind: "token", tokenId: "t" });
    mockContext.mockResolvedValue({ userId: "u", workspaceId: "ws", role: "OWNER" });
    const res = await route.PUT(
      new NextRequest("http://localhost/api/channels/instagram/acc/vendedor", { method: "PUT", body: JSON.stringify({ enabled: true }), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: "acc" }) }
    );
    expect(res.status).toBe(403);
    expect(mockPrisma.vendedorIgConfig.upsert).not.toHaveBeenCalled();
  });

  it("o dono logado liga e fica registrado quem ligou", async () => {
    mockCaller.mockResolvedValue({ kind: "session" });
    mockContext.mockResolvedValue({ userId: "u_dono", workspaceId: "ws", role: "OWNER" });
    const res = await route.PUT(
      new NextRequest("http://localhost/x", { method: "PUT", body: JSON.stringify({ enabled: true }), headers: { "content-type": "application/json" } }),
      { params: Promise.resolve({ id: "acc" }) }
    );
    expect(res.status).toBe(200);
    expect((mockPrisma.vendedorIgConfig.upsert.mock.calls[0][0] as { update: unknown }).update).toMatchObject({ enabled: true, enabledBy: "u_dono" });
  });

  it("valida a configuração da tela", () => {
    expect(validarPatch({ minGapSeconds: 2 }).ok).toBe(false);
    expect(validarPatch({ enabled: "sim" }).ok).toBe(false);
    expect(validarPatch({ quietStart: "25:00" }).ok).toBe(false);
    expect(validarPatch({ replyDelayMinSec: 100, replyDelayMaxSec: 50 }).ok).toBe(false);
    expect(validarPatch({ maxPerDay: 40, quietStart: null })).toEqual({ ok: true, patch: { maxPerDay: 40, quietStart: null } });
  });
});

describe("regras de decisão", () => {
  it("janela fechada não envia", async () => {
    const { deps, calls } = mk({ contato: async () => ({ lastInboundAt: new Date(now.getTime() - 25 * 3_600_000), humanTakeover: false, humanTakeoverUntil: null, broadcastOptOutAt: null }) });
    const r = await processarConversa(deps);
    expect(r).toMatchObject({ outcome: "skipped" });
    expect(r.motivo).toContain("24 h");
    expect(calls.enviar).not.toHaveBeenCalled();
    expect(calls.ia).not.toHaveBeenCalled();
  });

  it("conversa assumida (takeover) não envia", async () => {
    const { deps, calls } = mk({ contato: async () => ({ lastInboundAt: new Date(now.getTime() - 60_000), humanTakeover: true, humanTakeoverUntil: new Date(now.getTime() + 3_600_000), broadcastOptOutAt: null }) });
    const r = await processarConversa(deps);
    expect(r.outcome).toBe("skipped");
    expect(r.motivo).toContain("takeover");
    expect(calls.enviar).not.toHaveBeenCalled();
  });

  it.each(["parar", "Sair", "cancelar", "STOP", "não quero mais receber mensagens"])("pedido de parar (%s) para e registra", async (texto) => {
    const { deps, calls } = mk({}, [msg({ mid: "m1", text: texto, preview: texto })]);
    const r = await processarConversa(deps);
    expect(r.outcome).toBe("stopped");
    expect(calls.parada).toHaveBeenCalledWith("m1", texto);
    expect(calls.enviar).not.toHaveBeenCalled();
    expect(calls.ia).not.toHaveBeenCalled();
  });

  it("quem já pediu pra parar não recebe mais nada", async () => {
    const { deps, calls } = mk({ paradoAntes: async () => true });
    expect((await processarConversa(deps)).outcome).toBe("skipped");
    expect(calls.enviar).not.toHaveBeenCalled();
  });

  it("quem só agradeceu ou mandou emoji não recebe resposta (needs-reply)", async () => {
    for (const texto of ["obrigado!", "🙏", "valeu demais", "amém"]) {
      const { deps, calls } = mk({}, [msg({ mid: "m1", text: texto, preview: texto })]);
      expect((await processarConversa(deps)).outcome).toBe("skipped");
      expect(calls.enviar).not.toHaveBeenCalled();
    }
  });

  it("rascunho pendente do dono: não atropela", async () => {
    const { deps, calls } = mk({ temRascunhoPendente: async () => true });
    expect((await processarConversa(deps)).outcome).toBe("skipped");
    expect(calls.enviar).not.toHaveBeenCalled();
  });

  it("limite por pessoa e por dia viram 'pulou'; por hora, fila, espera humana e silêncio só esperam", () => {
    const base = {
      now, config, mensagens: [{ mid: "m1", fromMe: false, text: "quero saber mais?", storyReply: false, sentAt: new Date(now.getTime() - 300_000) }],
      contato: { lastInboundAt: new Date(now.getTime() - 300_000), humanTakeover: false, humanTakeoverUntil: null, broadcastOptOutAt: null },
      temRascunhoPendente: false, paradoAntes: false, contagens: { hora: 0, dia: 0, pessoaDia: 0, ultimoEnvioEm: null },
    };
    expect(decidir(base).acao).toBe("responder");
    expect(decidir({ ...base, contagens: { ...base.contagens, pessoaDia: 8 } }).acao).toBe("pular");
    expect(decidir({ ...base, contagens: { ...base.contagens, dia: 60 } }).acao).toBe("pular");
    expect(decidir({ ...base, contagens: { ...base.contagens, hora: 12 } }).acao).toBe("esperar");
    expect(decidir({ ...base, contagens: { ...base.contagens, ultimoEnvioEm: new Date(now.getTime() - 2000) } }).acao).toBe("esperar");
    expect(decidir({ ...base, contagens: { ...base.contagens, ultimoEnvioEm: new Date(now.getTime() - 6000) } }).acao).toBe("responder");
    const recente = { ...base.mensagens[0], sentAt: new Date(now.getTime() - 3000) };
    expect(decidir({ ...base, mensagens: [recente] }).acao).toBe("esperar");
    expect(decidir({ ...base, now: new Date("2026-10-28T04:00:00Z") }).acao).toBe("esperar"); // 1h em Brasília
  });

  it("espera humana é estável por DM e fica dentro de 20 a 90 s", () => {
    const e = esperaDaDm("mid_abc", 20, 90);
    expect(e).toBe(esperaDaDm("mid_abc", 20, 90));
    expect(e).toBeGreaterThanOrEqual(20_000);
    expect(e).toBeLessThanOrEqual(90_000);
  });

  it("detecta pedido de parar, pergunta de robô e assunto sensível", () => {
    expect(pedidoDeParar("cancelar")).toBe(true);
    expect(pedidoDeParar("quero cancelar o pedido do bolo")).toBe(false);
    expect(perguntouSeERobo("você é um robô?")).toBe(true);
    expect(perguntouSeERobo("isso é IA?")).toBe(true);
    expect(perguntouSeERobo("tem alguém de verdade aí?")).toBe(true);
    expect(perguntouSeERobo("como uso o robô de vendas?")).toBe(false);
    expect(assuntoSensivel("quero reembolso")).toBe(true);
    expect(assuntoSensivel("quanto custa?")).toBe(false);
  });
});

describe("resposta", () => {
  it("caminho feliz: envia em até 3 partes e registra", async () => {
    const { deps, calls } = mk();
    const r = await processarConversa(deps);
    expect(r.outcome).toBe("sent");
    const partes = calls.enviar.mock.calls[0][0] as string[];
    expect(partes.length).toBeGreaterThanOrEqual(1);
    expect(partes.length).toBeLessThanOrEqual(3);
    expect(partes[partes.length - 1]).toContain("?");
    expect(calls.final.mock.calls[0][1]).toMatchObject({ outcome: "sent", reason: "respondeu sozinho", model: "claude-haiku-4-5" });
  });

  it("IA falhou: NÃO envia nem cria rascunho, registra o erro", async () => {
    const { deps, calls } = mk({ perguntarIa: async () => { throw new ErroModelo("fora_do_ar", 503); } });
    const r = await processarConversa(deps);
    expect(r.outcome).toBe("error");
    expect(calls.enviar).not.toHaveBeenCalled();
    expect(calls.final.mock.calls[0][1].outcome).toBe("error");
  });

  it("resposta ilegível da IA: nada enviado", async () => {
    const { deps, calls } = mk({ perguntarIa: async () => ({ texto: "não sei", modelo: "m", custoMicro: 1 }) });
    expect((await processarConversa(deps)).outcome).toBe("error");
    expect(calls.enviar).not.toHaveBeenCalled();
  });

  it("IA em dúvida (confiança baixa) vira rascunho", async () => {
    const { deps, calls } = mk({ perguntarIa: iaOk(["Boa pergunta, deixa eu ver."], { confianca: CONFIANCA_MINIMA - 0.1 }) as never });
    const r = await processarConversa(deps);
    expect(r.outcome).toBe("draft");
    expect(calls.enviar).not.toHaveBeenCalled();
    expect(calls.rascunho).toHaveBeenCalled();
  });

  it("IA pede o dono: rascunho", async () => {
    const { deps, calls } = mk({ perguntarIa: iaOk(["Vou confirmar isso pra você."], { passar_pro_dono: true, motivo: "pergunta fora do perfil" }) as never });
    expect((await processarConversa(deps)).outcome).toBe("draft");
    expect(calls.enviar).not.toHaveBeenCalled();
  });

  it.each([
    ["preço inventado", "Custa R$ 47 hoje.", "preço"],
    ["link inventado", "Compra aqui: https://exemplo.com/oferta", "link"],
    ["prazo inventado", "Você tem 30 dias de garantia.", "prazo"],
    ['usa "tu"', "Tu vai gostar muito.", "tu"],
    ['diz "prompt"', "Esse prompt resolve.", "prompt"],
    ['diz que "faz por você"', "A IA faz por você.", "faz por"],
  ])("%s vira rascunho, nunca envio", async (_n, texto) => {
    const { deps, calls } = mk({ perguntarIa: iaOk([texto]) as never });
    const r = await processarConversa(deps);
    expect(r.outcome).toBe("draft");
    expect(calls.enviar).not.toHaveBeenCalled();
    expect(calls.rascunho).toHaveBeenCalled();
  });

  it("o preço e o link do documento de fatos passam", async () => {
    const { deps, calls } = mk({ perguntarIa: iaOk([`Sai 12x de R$ 10,03 ou R$ 97 à vista. Compra por aqui: ${LINK_CHECKOUT}`, "Quer que eu explique o que vem?"]) as never });
    expect((await processarConversa(deps)).outcome).toBe("sent");
    expect(calls.enviar).toHaveBeenCalled();
  });

  it("pergunta se é robô: diz a verdade, chama o dono e não gasta IA", async () => {
    const { deps, calls } = mk({}, [msg({ mid: "m1", text: "você é um robô?", preview: "você é um robô?" })]);
    const r = await processarConversa(deps);
    expect(r.outcome).toBe("sent");
    expect(calls.ia).not.toHaveBeenCalled();
    expect((calls.enviar.mock.calls[0][0] as string[]).join(" ")).toContain("inteligência artificial");
    expect(calls.dono).toHaveBeenCalled();
  });

  it("assunto sensível fica pro dono sem gastar IA", async () => {
    const { deps, calls } = mk({}, [msg({ mid: "m1", text: "quero reembolso, vou chamar o procon", preview: "x" })]);
    expect((await processarConversa(deps)).outcome).toBe("skipped");
    expect(calls.ia).not.toHaveBeenCalled();
    expect(calls.enviar).not.toHaveBeenCalled();
  });

  it("teto de gasto de IA atingido: não chama a IA", async () => {
    const { deps, calls } = mk({ podeGastar: async () => false });
    expect((await processarConversa(deps)).outcome).toBe("skipped");
    expect(calls.ia).not.toHaveBeenCalled();
  });

  it("a pessoa escreveu de novo enquanto a IA pensava: não envia a resposta velha", async () => {
    const seq = [
      [msg({ mid: "m1", text: "quanto custa?", preview: "x" })],
      [msg({ mid: "m1", text: "quanto custa?", preview: "x" }), msg({ mid: "m2", text: "na verdade esquece", preview: "x" })],
    ];
    let i = 0;
    const { deps, calls } = mk({ mensagens: async () => seq[Math.min(i++, 1)] });
    const r = await processarConversa(deps);
    expect(r.outcome).toBe("skipped");
    expect(calls.enviar).not.toHaveBeenCalled();
  });

  it("takeover que começou durante a geração bloqueia o envio", async () => {
    let n = 0;
    const livre = { lastInboundAt: new Date(now.getTime() - 300_000), humanTakeover: false, humanTakeoverUntil: null, broadcastOptOutAt: null };
    const { deps, calls } = mk({ contato: async () => (n++ < 1 ? livre : { ...livre, humanTakeover: true, humanTakeoverUntil: new Date(now.getTime() + 3_600_000) }) });
    expect((await processarConversa(deps)).outcome).toBe("skipped");
    expect(calls.enviar).not.toHaveBeenCalled();
  });

  it("falha no envio da 2ª parte fica registrada com o que já saiu", async () => {
    const { deps, calls } = mk({ enviar: async () => ({ mids: ["a"], falha: { indice: 1, mensagem: "boom", janelaFechada: false } }) });
    const r = await processarConversa(deps);
    expect(r.outcome).toBe("error");
    expect(calls.final.mock.calls[0][1].mids).toEqual(["a"]);
  });

  it("janela fechada na hora de enviar vira falha clara", async () => {
    const { deps } = mk({ enviar: async () => ({ mids: [], falha: { indice: 0, mensagem: "x", janelaFechada: true } }) });
    expect((await processarConversa(deps)).motivo).toContain("janela de 24 h fechou");
  });

  it("DM já tratada por outra rodada não é tratada de novo", async () => {
    const { deps, calls } = mk({ reservar: async () => null });
    expect((await processarConversa(deps)).outcome).toBe("esperar");
    expect(calls.enviar).not.toHaveBeenCalled();
  });
});

describe("prompt, cartão e saída", () => {
  it("o Comando fixo carrega as regras do dono e os fatos", () => {
    const s = sistemaFixo({ offerFacts: "", socialProof: "" });
    expect(s).toContain("Nunca use \"tu\"");
    expect(s).toContain("Comando");
    expect(s).toContain("habilidade");
    expect(s).toContain("R$ 97");
    expect(s).toContain(LINK_CHECKOUT);
    expect(s).toContain("não cite depoimento");
    expect(DEFAULT_OFFER_FACTS).toContain("sck=vendedor-ig");
  });

  it("prova social só entra se o dono cadastrou", () => {
    expect(sistemaFixo({ offerFacts: "", socialProof: "Ana fez 3 vídeos na primeira semana" })).toContain("Ana fez 3 vídeos");
  });

  it("lê JSON mesmo com cerca de código e rejeita lixo", () => {
    expect(lerSaidaVendedor('```json\n{"partes":["oi"],"confianca":0.8}\n```')?.partes).toEqual(["oi"]);
    expect(lerSaidaVendedor("sem json")).toBeNull();
    expect(violacoesDeVoz("Tu vai ver")).toHaveLength(1);
  });

  it("cartão da pessoa usa só o que existe e dentro de <dados>", () => {
    expect(montarCartao({ nome: null, username: null, etiquetas: [], anotacoes: null, comentarios: [], quiz: {}, seguidores: null, seguePraNos: null })).toBe("");
    const c = montarCartao({ nome: "Ana", username: "ana.makes", etiquetas: ["comentou:COMANDO"], anotacoes: null, comentarios: ["quero aprender foto de produto"], quiz: { ramo: "maquiagem" }, seguidores: 1200, seguePraNos: true });
    expect(c).toContain("<dados");
    expect(c).toContain("maquiagem");
    expect(c).toContain("1200");
    expect(c).not.toContain("foto de perfil");
  });

  it("cache do perfil: 24 h", () => {
    expect(perfilVencido(null, now)).toBe(true);
    expect(perfilVencido(new Date(now.getTime() - 3_600_000), now)).toBe(false);
    expect(perfilVencido(new Date(now.getTime() - 25 * 3_600_000), now)).toBe(true);
  });
});
