/**
 * Regras duras do negócio, ficha do lead, estágio no CRM, aprendizado,
 * bolhas, juntar mensagens e "Testar o agente", sem IA de verdade (modelo
 * falso) e com regras FICTÍCIAS (__tests__/helpers/regras-fixtures.ts).
 */
import { describe, expect, it, vi } from "vitest";
import { encryptToken } from "@/lib/meta/oauth";
import { StoreRegras } from "./helpers/wa-regras-store";
import { AGORA, cliente, contextoComRegras, lojaOnline, modeloFalso, nos, obraBoa, respostaAgente, salao } from "./helpers/regras-fixtures";
import { aprenderRespostaHumana, aprovarRascunho, processarMensagem, rejeitarRascunho, type DepsMotor } from "@/lib/whatsapp/agentes/motor";
import { montarComando } from "@/lib/whatsapp/agentes/comando";
import { chamarModelo } from "@/lib/whatsapp/agentes/provedores";
import { frases, perguntaNoFim, planejarRitmo, quebrarEmBolhas } from "@/lib/whatsapp/agentes/bolhas";
import { agentIngestHooks, debounceMs } from "@/lib/whatsapp/agentes/worker";
import { aoMensagemDoContato } from "@/lib/whatsapp/agentes/modo";
import { detectarExcecaoLocal, detectarLocal, detectarServico, SINAIS_VAZIOS } from "@/lib/whatsapp/regras/detectar";
import { lerRegras, regrasVazias, temRegras } from "@/lib/whatsapp/regras/esquema";
import { classificarLead, decidirMudanca, estagioNaTela } from "@/lib/whatsapp/regras/estagio";
import { exemploDaRespostaHumana, exemplosParecidos, limparExemplo } from "@/lib/whatsapp/regras/exemplos";
import { camposDaFicha, conferirExtracao, editarFicha, fichaVazia, juntarFicha, preencherPorRegra } from "@/lib/whatsapp/regras/ficha";
import { blocoRegras } from "@/lib/whatsapp/regras/prompt";
import { aplicarMudanca, lerSugestoesIa, sugestoesDosCasos } from "@/lib/whatsapp/regras/sugestoes";
import { SISTEMA_CLIENTE, testarAgente, turnosDoTeste } from "@/lib/whatsapp/regras/testar";
import { cidadesDoTexto, cidadesParaTexto, itensDoTexto, itensParaTexto, lerCidade, regioesDoTexto, regioesParaTexto } from "@/lib/whatsapp/regras/texto";
import { verificarResposta, type SaidaParaVerificar } from "@/lib/whatsapp/regras/verificar";
import { regrasDaIa } from "@/lib/whatsapp/treinar/regras";
import type { WaMessageLite } from "@/lib/whatsapp/agentes/types";
import type { PedidoModelo } from "@/lib/whatsapp/agentes/provedores";

process.env.ENCRYPTION_KEY = "a".repeat(64);
const CHAVE = "sk-ant-api03-SEGREDO-NAO-PODE-VAZAR-1234567890abcd";

const R = obraBoa();
const local = (h: WaMessageLite[], sinais = SINAIS_VAZIOS) => detectarLocal(R, h, sinais);

function preparar(historico: WaMessageLite[], regras = obraBoa(), over: Parameters<typeof contextoComRegras>[2] = {}) {
  const store = new StoreRegras();
  const ctx = contextoComRegras(historico, regras, over);
  store.contextos.set(ctx.conversation.id, ctx);
  store.configs = [{ agente: "qualificacao", ativo: true, provider: "anthropic" }];
  store.credenciais.push({ id: "k1", ownerUserId: "u1", provider: "anthropic", keyEnc: encryptToken(CHAVE), keyLast4: "abcd", dailyCap: 500, createdAt: AGORA, revokedAt: null });
  return { store, ctx };
}

function deps(store: StoreRegras, chamar: DepsMotor["chamar"], extra: Partial<DepsMotor> = {}): DepsMotor {
  return { store, cerebro: { buscar: async () => [] }, chamar, limites: { tetoUsuarioUsd: 50, tetoWorkspaceUsd: 100 }, rng: () => 0, jev: { apiKey: "" }, ...extra };
}

function ultimoId(h: WaMessageLite[]) {
  return [...h].reverse().find((m) => !m.fromMe)!.id;
}

function saida(o: Partial<SaidaParaVerificar> & { bolhas: string[] }): SaidaParaVerificar {
  return { passarPraHumano: false, qualificado: false, motivo: "", ...o };
}

function verificar(historico: WaMessageLite[], s: SaidaParaVerificar, regras = R, ficha = fichaVazia(), agente: "qualificacao" | "atendimento" | "suporte" = "qualificacao", nomes: string[] = []) {
  return verificarResposta({ regras, agente, historico, saida: s, ficha, defs: camposDaFicha(regras), nomesDoContato: nomes });
}

/* ============================== cidade da obra ============================== */

describe("cidade da obra (sem IA)", () => {
  it("reconhece Paulínia e Campinas com e sem acento, maiúscula e UF", () => {
    for (const t of ["a obra é em Paulinia", "PAULÍNIA", "fica em paulínia/sp", "é em campinas sp", "Campinas - SP", "CAMPINAS/SP"]) {
      const l = local([cliente(t)]);
      expect(l.status, t).toBe("atendida");
    }
    expect(local([cliente("obra em Paulinia")]).cidade).toBe("Paulínia/SP");
    expect(local([cliente("campinas sp")]).cidade).toBe("Campinas/SP");
  });

  it("Hortolândia fica fora (está na lista de não atendidas)", () => {
    const l = local([cliente("Oi, a reforma é em Hortolandia")]);
    expect(l).toMatchObject({ status: "fora", cidade: "Hortolândia/SP", naoAtendidaListada: true });
  });

  it("cidade fora das listas com UF (Sumaré/SP) fica fora", () => {
    expect(local([cliente("Quero reformar meu apartamento em Sumaré/SP")])).toMatchObject({ status: "fora", cidade: "Sumaré/SP", naoAtendidaListada: false });
    expect(local([cliente("a obra é em sumare - sp")])).toMatchObject({ status: "fora" });
  });

  it("bairro Campo Grande (Campinas) é região com cuidado; Campo Grande/MS é outra cidade", () => {
    expect(local([cliente("minha casa fica no Campo Grande, em Campinas")])).toMatchObject({ status: "cuidado", regiao: "Campo Grande", cidade: "Campinas/SP" });
    expect(local([cliente("é no campo grande")])).toMatchObject({ status: "cuidado" });
    expect(local([cliente("a obra é em Campo Grande/MS")])).toMatchObject({ status: "fora" });
  });

  it("cidade não informada fica desconhecida", () => {
    expect(local([cliente("quanto custa uma reforma de banheiro?")]).status).toBe("desconhecida");
    expect(local([]).status).toBe("desconhecida");
  });

  it("onde a pessoa mora não é a obra", () => {
    expect(local([cliente("moro em Hortolândia mas a obra é em Paulínia")]).status).toBe("atendida");
    expect(local([cliente("a obra é em Paulínia, eu moro em Hortolândia")]).status).toBe("atendida");
    expect(local([cliente("eu moro em Hortolândia")]).status).toBe("desconhecida");
  });

  it("lê a cidade da transcrição do áudio", () => {
    const audio = cliente("", 1, { type: "audio", mediaText: "oi, a reforma é lá em Hortolândia, tá?", mediaTextKind: "audio" });
    expect(local([audio]).status).toBe("fora");
  });

  it("o que o modelo diz só vale se estiver no texto do cliente", () => {
    const h = [cliente("a obra é em Sumaré")];
    expect(local(h).status).toBe("desconhecida");
    expect(local(h, { ...SINAIS_VAZIOS, localObra: { cidade: "Paulínia", uf: "SP", bairro: "" } }).status).toBe("desconhecida");
    expect(local(h, { ...SINAIS_VAZIOS, localObra: { cidade: "Sumaré", uf: "SP", bairro: "" } })).toMatchObject({ status: "fora", cidade: "Sumaré/SP", fonte: "modelo" });
  });

  it("só mensagens do cliente contam (o agente citar Paulínia não é o local da obra)", () => {
    expect(local([nos("A gente atende Paulínia e Campinas."), cliente("legal")]).status).toBe("desconhecida");
  });

  it("exceção de local pela palavra do cliente ou pelo modelo", () => {
    expect(detectarExcecaoLocal(R, [cliente("é uma obra grande, um prédio")])).toBe("Obra grande fora da região");
    expect(detectarExcecaoLocal(R, [cliente("é uma casinha")])).toBeNull();
  });
});

/* ============================== serviço ============================== */

describe("serviço", () => {
  it("pequeno reparo é recusado; pedra é exceção; o resto segue o modelo", () => {
    expect(detectarServico(R, [cliente("quero trocar uma torneira")])).toMatchObject({ status: "recusado", descricao: "Pequeno reparo isolado" });
    expect(detectarServico(R, [cliente("quero só uma bancada de granito")])).toMatchObject({ status: "excecao" });
    expect(detectarServico(R, [cliente("reforma completa do apartamento")], { ...SINAIS_VAZIOS, servico: "aceito" }).status).toBe("aceito");
    expect(detectarServico(R, [cliente("é um servicinho")], { ...SINAIS_VAZIOS, servico: "recusado" }).status).toBe("recusado");
    expect(detectarServico(R, [cliente("oi")]).status).toBe("desconhecido");
  });
});

/* ============================== verificação ============================== */

describe("verificação determinística", () => {
  it("qualificado fora da área é bloqueado e nunca vira qualificado", () => {
    const v = verificar([cliente("apartamento em Sumaré/SP")], saida({ bolhas: ["Perfeito!"], qualificado: true, passarPraHumano: true }));
    expect(v.violacoes.map((x) => x.regra)).toContain("qualificado_fora_da_area");
    expect(v.decisao).not.toBe("qualificar");
    expect(v.violacoes[0].paraModelo).toContain("Paulínia/SP e Campinas/SP");
  });

  it("cidade não informada: qualificado é proibido e o agente tem que perguntar onde é a obra", () => {
    const v = verificar([cliente("quero reformar meu apartamento")], saida({ bolhas: ["Show, já passo pra equipe."], qualificado: true }));
    expect(v.violacoes.map((x) => x.regra)).toContain("qualificado_sem_local");
    const semPergunta = verificar([cliente("quero reformar meu apartamento")], saida({ bolhas: ["Legal! Me conta mais."] }));
    expect(semPergunta.violacoes.map((x) => x.regra)).toContain("nao_perguntou_local");
    const comPergunta = verificar([cliente("quero reformar meu apartamento")], saida({ bolhas: ["Legal!", "Em qual cidade vai ser a obra?"] }));
    expect(comPergunta.violacoes).toEqual([]);
  });

  it("confirmar atendimento fora da área ou antes de saber o local é violação", () => {
    expect(verificar([cliente("obra em Hortolândia")], saida({ bolhas: ["Atendemos sim!"] })).violacoes.map((x) => x.regra)).toContain("confirmou_fora_da_area");
    expect(verificar([cliente("obra em Sumaré/SP")], saida({ bolhas: ["A gente atende Sumaré tranquilo"] })).violacoes.map((x) => x.regra)).toContain("confirmou_fora_da_area");
    expect(verificar([cliente("vocês atendem minha cidade?")], saida({ bolhas: ["Claro, atendemos sim!"] })).violacoes.map((x) => x.regra)).toContain("confirmou_sem_local");
    // Informar as cidades atendidas não é confirmar a cidade do cliente.
    expect(verificar([cliente("obra em Sumaré/SP")], saida({ bolhas: ["A gente atende Paulínia e Campinas. Pra Sumaré a disponibilidade precisa ser analisada."] })).violacoes).toEqual([]);
  });

  it("recusa seca fora da área é violação; com cuidado, não", () => {
    expect(verificar([cliente("obra em Sumaré/SP")], saida({ bolhas: ["Não atendemos aí."] })).violacoes.map((x) => x.regra)).toContain("recusa_seca");
    expect(verificar([cliente("obra em Sumaré/SP")], saida({ bolhas: ["Poxa, infelizmente ainda não atendemos aí, mas a disponibilidade pode ser analisada."] })).violacoes).toEqual([]);
    // Região com cuidado: nunca dizer que não atende.
    expect(verificar([cliente("casa no Campo Grande, Campinas")], saida({ bolhas: ["Infelizmente não atendemos o Campo Grande."] })).violacoes.map((x) => x.regra)).toContain("recusa_seca");
  });

  it("exceção (obra grande fora da região) vira análise, nunca qualificado", () => {
    const v = verificar([cliente("Tenho uma obra grande em Sumaré/SP, um prédio de 4 andares")], saida({ bolhas: ["Vou passar pra equipe analisar."], qualificado: true, passarPraHumano: true }));
    expect(v.violacoes).toEqual([]);
    expect(v.decisao).toBe("analisar");
    expect(v.motivo).toContain("Obra grande fora da região");
  });

  it("região com cuidado vai pra análise quando o agente passa pra equipe", () => {
    const v = verificar([cliente("casa de médio porte no Campo Grande, em Campinas")], saida({ bolhas: ["Vou passar pra equipe analisar com carinho."], passarPraHumano: true, motivo: "para analisar" }));
    expect(v.decisao).toBe("analisar");
  });

  it("serviço recusado sem exceção: nunca qualificado e nunca 'fazemos sim'", () => {
    const h = [cliente("quero trocar uma torneira em Paulínia")];
    expect(verificar(h, saida({ bolhas: ["Ok!"], qualificado: true })).violacoes.map((x) => x.regra)).toContain("qualificado_servico_recusado");
    expect(verificar(h, saida({ bolhas: ["Fazemos sim!"] })).violacoes.map((x) => x.regra)).toContain("confirmou_servico_recusado");
    const educada = verificar(h, saida({ bolhas: ["A gente trabalha com reformas completas e não faz pequenos serviços isolados, tá?"] }));
    expect(educada.violacoes).toEqual([]);
    expect(educada.decisao).toBe("servico_recusado");
    // Pedra é exceção: segue.
    expect(verificar([cliente("quero uma bancada de granito em Campinas")], saida({ bolhas: ["Fazemos sim! É casa ou apartamento?"] })).violacoes).toEqual([]);
  });

  it("qualificado só com TODAS as informações mínimas", () => {
    const falta = verificar([cliente("apartamento em Paulínia, quero reforma completa")], saida({ bolhas: ["Vou passar pra equipe."], qualificado: true }));
    expect(falta.violacoes.map((x) => x.regra)).toEqual(["qualificado_sem_info"]);
    expect(falta.faltando.map((f) => f.rotulo)).toEqual(["Nome", "Situação das chaves", "Possui projeto"]);
    const completo = verificar(
      [cliente("Oi, sou a Marina, apartamento em Paulínia, já peguei as chaves e tenho projeto, quero reforma completa")],
      saida({ bolhas: ["Perfeito! Vou passar pra equipe seguir com você."], qualificado: true, passarPraHumano: true })
    );
    expect(completo.violacoes).toEqual([]);
    expect(completo.decisao).toBe("qualificar");
  });

  it("não deixa perguntar de novo o que o cliente já respondeu", () => {
    const h = [cliente("obra em Campinas")];
    const defs = camposDaFicha(R);
    const ficha = juntarFicha(fichaVazia(), preencherPorRegra(defs, { regras: R, historico: h, local: local(h), servico: detectarServico(R, h), nomesDoContato: { name: null, pushName: null }, now: AGORA }), AGORA).ficha;
    const v = verificar(h, saida({ bolhas: ["Em qual cidade vai ser a obra?"] }), R, ficha);
    expect(v.violacoes.map((x) => x.regra)).toContain("perguntou_de_novo");
  });

  it("promessa é violação quando o briefing diz o que nunca prometer", () => {
    expect(verificar([cliente("obra em Campinas")], saida({ bolhas: ["Te garanto que fica ótimo! Já pegou as chaves?"] })).violacoes.map((x) => x.regra)).toContain("promessa");
  });

  it("sem lista de cidades (loja que atende o Brasil todo), cidade nenhuma é fora da área", () => {
    const v = verificar([cliente("Quero uma capinha pro iPhone 15, entrega em Manaus/AM, meu cep é 69000-000")], saida({ bolhas: ["Show!"], qualificado: true }), lojaOnline());
    expect(v.local.status).toBe("atendida");
    expect(v.violacoes).toEqual([]);
    expect(v.decisao).toBe("qualificar");
    // Sem cidade nenhuma também não trava.
    const semCidade = verificar([cliente("quero capinha pro iPhone 15, cep 69000-000")], saida({ bolhas: ["Show!"], qualificado: true }), lojaOnline());
    expect(semCidade.violacoes).toEqual([]);
    expect(semCidade.decisao).toBe("qualificar");
  });
});

/* ============================== motor ============================== */

describe("motor com regras duras", () => {
  it("D) Sumaré com Paulínia/SP e Campinas/SP: corrige uma vez, sai a resposta de fora da área, nunca qualificado, ficha guarda Sumaré", async () => {
    const h = [cliente("Oi, quero reformar meu apartamento em Sumaré/SP")];
    const { store, ctx } = preparar(h);
    const usos: string[] = [];
    const m = modeloFalso([
      respostaAgente({ bolhas: ["Que legal! Atendemos sim, vamos marcar uma reunião?"], qualificado: true, passar: true }),
      respostaAgente({ bolhas: ["Poxa, infelizmente a gente não atende Sumaré. Obrigado pelo contato e boa sorte com a obra!"], local: { cidade: "Sumaré", uf: "SP" } }),
    ]);
    const r = await processarMensagem(deps(store, m.chamar, { registrarUso: async (u) => void usos.push(u.kind ?? "agent") }), { conversationId: ctx.conversation.id, triggerMsgId: ultimoId(h), now: AGORA });
    expect(r.acao).toBe("agendado");
    if (r.acao === "agendado") expect(r.bolhas.join(" ")).toContain("não atende Sumaré");
    expect(ctx.conversation.humanTakeoverUntil).toBeNull();
    // Uma correção só, com a regra explicada.
    const doAgente = m.doAgente();
    expect(doAgente).toHaveLength(2);
    const correcao = doAgente[1].mensagens[doAgente[1].mensagens.length - 1].content;
    expect(correcao).toContain("Sumaré/SP");
    expect(correcao).toContain("Paulínia/SP e Campinas/SP");
    // Estágio, ficha e casos.
    const ultimo = store.estagios[store.estagios.length - 1];
    expect(ultimo.nova).toMatchObject({ estagio: "fora_do_perfil", tipo: "regiao" });
    expect(ultimo.nova.motivo).toBe("obra em Sumaré/SP, fora de Paulínia/SP e Campinas/SP");
    const ficha = store.fichas.get(ctx.conversation.id)!;
    expect(ficha.campos.local_da_obra).toMatchObject({ valor: "Sumaré/SP", nota: "fora da área", origem: "confirmado", msgId: h[0].id });
    expect(store.casos.map((c) => c.tipo)).toEqual(expect.arrayContaining(["regra_corrigiu", "fora_da_area"]));
    expect(store.casos.find((c) => c.tipo === "fora_da_area")?.assunto).toBe("Sumaré/SP");
    // Gastos: a ficha (kind ficha) e as duas do agente.
    expect(usos).toEqual(["ficha", "agent", "agent"]);
  });

  it("se a correção também quebrar a regra, não sai nada: vira rascunho com o aviso", async () => {
    const h = [cliente("obra em Hortolândia, uma casa")];
    const { store, ctx } = preparar(h);
    const m = modeloFalso([respostaAgente({ bolhas: ["Atendemos sim! Bora marcar?"], qualificado: true, passar: true })]);
    const r = await processarMensagem(deps(store, m.chamar), { conversationId: ctx.conversation.id, triggerMsgId: ultimoId(h), now: AGORA });
    expect(r.acao).toBe("rascunho");
    if (r.acao === "rascunho") expect(r.alerta).toContain("Regra do negócio");
    expect(store.envios).toHaveLength(0);
    expect(m.doAgente()).toHaveLength(2);
    expect(ctx.conversation.humanTakeoverUntil).toBeNull();
    expect(store.casos.find((c) => c.tipo === "regra_bloqueou")?.regra).toContain("qualificado_fora_da_area");
    expect(store.estagios[store.estagios.length - 1].nova.estagio).toBe("fora_do_perfil");
  });

  it("obra grande fora da região vai pra análise e transfere com esse motivo", async () => {
    const h = [cliente("Tenho uma obra grande em Sumaré/SP, um prédio de 4 andares")];
    const { store, ctx } = preparar(h);
    const m = modeloFalso([respostaAgente({ bolhas: ["Perfeito! Vou passar pra equipe analisar com carinho."], qualificado: true, passar: true })]);
    const r = await processarMensagem(deps(store, m.chamar), { conversationId: ctx.conversation.id, triggerMsgId: ultimoId(h), now: AGORA });
    expect(r.acao).toBe("humano");
    if (r.acao === "humano") {
      expect(r.motivo).toMatch(/^para analisar:/);
      expect(r.motivo).toContain("Obra grande fora da região");
    }
    expect(ctx.conversation.humanTakeoverUntil).not.toBeNull();
    expect(store.estagios[store.estagios.length - 1].nova.estagio).toBe("analisar");
    expect(m.doAgente()).toHaveLength(1);
  });

  it("serviço recusado: resposta educada, nunca qualificado, estágio fora do perfil (serviço)", async () => {
    const h = [cliente("Quero só trocar uma torneira lá em Paulínia")];
    const { store, ctx } = preparar(h);
    const m = modeloFalso([
      respostaAgente({ bolhas: ["Fazemos sim! Já te passo pra equipe."], qualificado: true, passar: true }),
      respostaAgente({ bolhas: ["Poxa, a gente trabalha com reformas completas e não faz pequenos serviços isolados, tá?"] }),
    ]);
    const r = await processarMensagem(deps(store, m.chamar), { conversationId: ctx.conversation.id, triggerMsgId: ultimoId(h), now: AGORA });
    expect(r.acao).toBe("agendado");
    expect(store.estagios[store.estagios.length - 1].nova).toMatchObject({ estagio: "fora_do_perfil", tipo: "servico" });
    expect(store.casos.some((c) => c.tipo === "servico_recusado")).toBe(true);
  });

  it("informação mínima faltando: não qualifica; se insistir, o rascunho já traz a pergunta que falta", async () => {
    const h = [cliente("apartamento em Paulínia, quero reforma completa")];
    const { store, ctx } = preparar(h);
    const m = modeloFalso([respostaAgente({ bolhas: ["Perfeito! Vou passar pra equipe."], qualificado: true, passar: true })]);
    const r = await processarMensagem(deps(store, m.chamar), { conversationId: ctx.conversation.id, triggerMsgId: ultimoId(h), now: AGORA });
    expect(r.acao).toBe("rascunho");
    if (r.acao === "rascunho") expect(r.bolhas).toEqual(["Qual o seu nome?"]);
    expect(store.estagios[store.estagios.length - 1].nova.estagio).toBe("qualificando");
    // E se a correção pergunta o que falta, sai normalmente.
    const s2 = preparar(h);
    const m2 = modeloFalso([
      respostaAgente({ bolhas: ["Perfeito! Vou passar pra equipe."], qualificado: true, passar: true }),
      respostaAgente({ bolhas: ["Show!", "Qual o seu nome?"] }),
    ]);
    const r2 = await processarMensagem(deps(s2.store, m2.chamar), { conversationId: s2.ctx.conversation.id, triggerMsgId: ultimoId(h), now: AGORA });
    expect(r2.acao).toBe("agendado");
  });

  it("qualificado de verdade: transfere com o resumo da ficha; aviso pro responsável só se ligado", async () => {
    const h = [cliente("Oi! Apartamento em Paulínia, já peguei as chaves e tenho projeto, quero reforma completa")];
    const { store, ctx } = preparar(h, obraBoa(), { pushName: "Marina Teste" });
    const m = modeloFalso([respostaAgente({ bolhas: ["Perfeito! Vou passar pra equipe seguir com você."], qualificado: true, passar: true })]);
    const r = await processarMensagem(deps(store, m.chamar), { conversationId: ctx.conversation.id, triggerMsgId: ultimoId(h), now: AGORA });
    expect(r.acao).toBe("humano");
    if (r.acao === "humano") {
      expect(r.motivo).toContain("lead qualificado");
      expect(r.motivo).toContain("Local da obra: Paulínia/SP (atendida)");
      expect(r.motivo).toContain("Nome: Marina Teste");
    }
    expect(store.estagios[store.estagios.length - 1].nova.estagio).toBe("qualificado");
    expect(store.avisos).toHaveLength(0);

    const s2 = preparar(h, obraBoa(), { pushName: "Marina Teste" });
    s2.ctx.profile!.avisarResponsavel = { ligado: true, telefone: "(19) 90000-3333" };
    const m2 = modeloFalso([respostaAgente({ bolhas: ["Perfeito! Vou passar pra equipe seguir com você."], qualificado: true, passar: true })]);
    const r2 = await processarMensagem(deps(s2.store, m2.chamar), { conversationId: s2.ctx.conversation.id, triggerMsgId: ultimoId(h), now: AGORA });
    expect(s2.store.avisos).toHaveLength(1);
    expect(s2.store.avisos[0].texto).toContain("Lead qualificado");
    if (r2.acao === "humano") expect(r2.motivo).toContain("resumo enviado pro WhatsApp do responsável");
  });

  it("regras, mensagens aprovadas e casos de teste vão SEMPRE na parte fixa (cache); ficha e o que falta na variável", async () => {
    const h = [cliente("obra em Campinas, uma casa")];
    const { store, ctx } = preparar(h);
    const m = modeloFalso([respostaAgente({ bolhas: ["Show!", "Você já pegou as chaves?"] })]);
    await processarMensagem(deps(store, m.chamar), { conversationId: ctx.conversation.id, triggerMsgId: ultimoId(h), now: AGORA });
    const p = m.doAgente()[0];
    expect(p.sistemaFixo).toContain("REGRAS DURAS DO NEGÓCIO");
    expect(p.sistemaFixo).toContain("Paulínia/SP, Campinas/SP");
    expect(p.sistemaFixo).toContain("CIDADES NÃO ATENDIDAS: Hortolândia/SP");
    expect(p.sistemaFixo).toContain("CASOS DO DONO");
    expect(p.sistemaFixo).toContain("Perfeito! Vou passar pra equipe seguir com você.");
    expect(p.sistemaFixo).toContain('"local_obra"');
    expect(p.sistemaVariavel).toContain("O QUE VOCÊ JÁ SABE");
    expect(p.sistemaVariavel).toContain("Campinas/SP");
    expect(p.sistemaVariavel).toContain("O QUE AINDA FALTA PERGUNTAR");
    expect(p.sistemaVariavel).toContain("Situação das chaves");
    // A ficha (dado do cliente) vai em <dados>.
    expect(p.sistemaVariavel).toMatch(/<dados origem="ficha do lead">[\s\S]*Campinas\/SP[\s\S]*<\/dados>/);
    // Anthropic: a parte fixa (com as regras) leva cache_control.
    let body: { system: Array<{ text: string; cache_control?: unknown }> } | null = null;
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ content: [{ type: "text", text: "{}" }], usage: {} }), { status: 200 });
    });
    await chamarModelo({ ...p, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(body!.system[0].text).toContain("REGRAS DURAS DO NEGÓCIO");
    expect(body!.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(body!.system[1].text).not.toContain("REGRAS DURAS DO NEGÓCIO");
  });

  it("sem regras, nada muda: sem chamada da ficha e sem bloco de regras", async () => {
    const h = [cliente("oi, vocês fazem bolo?")];
    const { store, ctx } = preparar(h, null as never);
    const m = modeloFalso([respostaAgente({ bolhas: ["Fazemos sim!"] })]);
    const r = await processarMensagem(deps(store, m.chamar), { conversationId: ctx.conversation.id, triggerMsgId: ultimoId(h), now: AGORA });
    expect(r.acao).toBe("agendado");
    expect(m.daFicha()).toHaveLength(0);
    expect(m.doAgente()[0].sistemaFixo).not.toContain("REGRAS DURAS");
  });
});

/* ============================== ficha do lead ============================== */

describe("ficha do lead", () => {
  const defs = camposDaFicha(R);

  it("campos vêm das regras (informações mínimas + resumo pra equipe + bairro)", () => {
    expect(defs.map((d) => d.rotulo)).toEqual(["Nome", "Local da obra", "Tipo de imóvel", "Situação das chaves", "Possui projeto", "Bairro", "Fotos enviadas"]);
    expect(defs.filter((d) => d.obrigatorio).map((d) => d.chave)).toEqual(["nome", "local_da_obra", "tipo_de_imovel", "situacao_das_chaves", "possui_projeto"]);
    expect(camposDaFicha(null)).toEqual([]);
  });

  it("preenche por regra com a mensagem de onde veio", () => {
    const h = [
      cliente("me chamo joana, é um apto no Campo Grande, em Campinas"),
      nos("Legal! Você já pegou as chaves?"),
      cliente("já sim"),
      cliente("", 1, { type: "image", mediaText: "foto de uma cozinha", mediaTextKind: "image" }),
    ];
    const v = preencherPorRegra(defs, { regras: R, historico: h, local: local(h), servico: detectarServico(R, h), nomesDoContato: { name: null, pushName: null }, now: AGORA });
    expect(v.nome).toMatchObject({ valor: "Joana", msgId: h[0].id, origem: "confirmado" });
    expect(v.local_da_obra).toMatchObject({ valor: "Campinas/SP", nota: "região com cuidado" });
    expect(v.bairro).toMatchObject({ valor: "Campo Grande" });
    expect(v.tipo_de_imovel).toMatchObject({ valor: "apartamento", origem: "inferido" });
    expect(v.situacao_das_chaves).toMatchObject({ valor: "sim", msgId: h[2].id });
    expect(v.fotos_enviadas).toMatchObject({ valor: "enviou foto", msgId: h[3].id });
  });

  it("o que o modelo extrai só entra com evidência na conversa (nunca inventa)", () => {
    const h = [cliente("tenho projeto", 3), nos("E o seu nome?", 2), cliente("Carlos", 1)];
    const ok = conferirExtracao(
      defs,
      {
        campos: {
          possui_projeto: { valor: "sim", msg: h[0].id },
          nome: { valor: "Carlos", msg: h[2].id },
          situacao_das_chaves: { valor: "já peguei", msg: h[0].id },
          tipo_de_imovel: { valor: "casa", msg: h[1].id },
          local_da_obra: { valor: "Campinas", msg: "nao-existe" },
        },
        memoria: null,
      },
      h,
      AGORA
    );
    expect(Object.keys(ok).sort()).toEqual(["nome", "possui_projeto"]);
    expect(ok.nome).toMatchObject({ valor: "Carlos", origem: "confirmado", msgId: h[2].id });
    expect(ok.possui_projeto.origem).toBe("inferido");
    // Telefone ou e-mail nunca vão pra ficha.
    const pii = conferirExtracao(defs, { campos: { nome: { valor: "(19) 98888-7777", msg: h[2].id } }, memoria: null }, [cliente("(19) 98888-7777")].map((m) => ({ ...m, id: h[2].id })), AGORA);
    expect(pii).toEqual({});
  });

  it("o que o dono escreveu vale como confirmado e o agente não sobrescreve", () => {
    const f = editarFicha(fichaVazia(), { local_da_obra: "Sumaré/SP", inventado: "x" }, defs, AGORA);
    expect(f.campos.local_da_obra).toMatchObject({ valor: "Sumaré/SP", origem: "dono" });
    expect(f.campos.inventado).toBeUndefined();
    const j = juntarFicha(f, { local_da_obra: { valor: "Campinas/SP", msgId: "c1", origem: "confirmado", em: "" } }, AGORA);
    expect(j.ficha.campos.local_da_obra.valor).toBe("Sumaré/SP");
    expect(j.mudou).toBe(false);
    // E a verificação usa a cidade do dono.
    const v = verificar([cliente("é em Campinas")], saida({ bolhas: ["ok"], qualificado: true }), R, f);
    expect(v.local.status).toBe("fora");
  });

  it("no motor: a chamada barata da ficha (Gastos de IA kind ficha) só entra com evidência e atualiza a memória do contato", async () => {
    const h = [cliente("Oi, sou o Paulo, apartamento em Campinas", 2), nos("Você já tem projeto?", 1), cliente("tenho sim, e já peguei as chaves", 0)];
    const { store, ctx } = preparar(h);
    const m = modeloFalso(
      [respostaAgente({ bolhas: ["Show!"] })],
      JSON.stringify({ campos: { possui_projeto: { valor: "sim", msg: h[2].id }, nome: { valor: "Roberto", msg: h[0].id } }, memoria: { interesse: "reforma de apartamento", etapa: "qualificando" } })
    );
    await processarMensagem(deps(store, m.chamar), { conversationId: ctx.conversation.id, triggerMsgId: ultimoId(h), now: AGORA });
    expect(m.daFicha()).toHaveLength(1);
    expect(m.daFicha()[0].mensagens[0].content).toContain(`CLIENTE id=${h[2].id}`);
    const ficha = store.fichas.get(ctx.conversation.id)!;
    expect(ficha.campos.nome.valor).toBe("Paulo");
    expect(ficha.campos.possui_projeto.valor).toBe("sim");
    expect(store.memoriaCerebro[0]).toMatchObject({ contactId: "ct1", update: { interesse: "reforma de apartamento" } });
  });
});

/* ============================== estágio do lead ============================== */

describe("estágio do lead (genérico, pelas regras de cada número)", () => {
  const classificar = (regras: ReturnType<typeof obraBoa>, h: WaMessageLite[], s: SaidaParaVerificar, sinais = SINAIS_VAZIOS) =>
    classificarLead({ regras, verificacao: verificar(h, { ...s, sinais }, regras), agente: "qualificacao", qualificadoPeloModelo: false });

  it("salão que atende só Itu/SP", () => {
    expect(classificar(salao(), [cliente("moro em Sorocaba, queria uma escova")], saida({ bolhas: ["Oi!"] }), { ...SINAIS_VAZIOS, localObra: { cidade: "Sorocaba", uf: "SP", bairro: "" } })).toMatchObject({
      estagio: "fora_do_perfil",
      tipo: "regiao",
      motivo: "obra em Sorocaba/SP, fora de Itu/SP",
    });
    expect(classificar(salao(), [cliente("aqui é de Itu/SP, quero fazer depilação")], saida({ bolhas: ["Oi!"] }))).toMatchObject({ estagio: "fora_do_perfil", tipo: "servico" });
    expect(classificar(salao(), [cliente("Oi, me chamo Ana, quero corte na sexta, sou daqui de Itu/SP")], saida({ bolhas: ["Fechado!"], qualificado: true, passarPraHumano: true }), { ...SINAIS_VAZIOS, localObra: { cidade: "Itu", uf: "SP", bairro: "" } }).estagio).toBe("qualificado");
  });

  it("loja online que atende o Brasil todo", () => {
    expect(classificar(lojaOnline(), [cliente("Sou de Manaus/AM, quero capinha pro iPhone 15, cep 69000-000")], saida({ bolhas: ["Show!"], qualificado: true })).estagio).toBe("qualificado");
    expect(classificar(lojaOnline(), [cliente("vocês consertam tela quebrada?")], saida({ bolhas: ["Oi!"] }))).toMatchObject({ estagio: "fora_do_perfil", tipo: "servico" });
    expect(classificar(lojaOnline(), [cliente("oi, quero uma capinha")], saida({ bolhas: ["Qual o modelo do seu celular?"] }))).toMatchObject({ estagio: "qualificando", motivo: expect.stringContaining("CEP de entrega") });
  });

  it("suporte é cliente; sem regra nenhuma, vale o que o agente disse", () => {
    expect(classificarLead({ regras: R, verificacao: null, agente: "suporte", qualificadoPeloModelo: false }).estagio).toBe("cliente");
    expect(classificarLead({ regras: regrasVazias(), verificacao: null, agente: "qualificacao", qualificadoPeloModelo: true }).estagio).toBe("qualificado");
    expect(classificarLead({ regras: null, verificacao: null, agente: "qualificacao", qualificadoPeloModelo: false }).estagio).toBe("qualificando");
  });

  it("mudança manual do dono vence até chegar fato novo", () => {
    const fora = { estagio: "fora_do_perfil" as const, motivo: "obra em Sumaré/SP", tipo: "regiao" as const };
    expect(decidirMudanca({ estagio: "qualificado", manual: true, motivo: "o dono marcou" }, fora, false)).toBeNull();
    expect(decidirMudanca({ estagio: "qualificado", manual: true, motivo: "o dono marcou" }, fora, true)).toEqual(fora);
    expect(decidirMudanca({ estagio: "fora_do_perfil", manual: false, motivo: "obra em Sumaré/SP" }, fora, true)).toBeNull();
    expect(decidirMudanca({ estagio: null, manual: false, motivo: null }, fora, false)).toEqual(fora);
  });

  it("no motor: estágio manual não muda sem fato novo na ficha", async () => {
    const h = [cliente("obra em Sumaré/SP")];
    const { store, ctx } = preparar(h);
    const defs = camposDaFicha(R);
    const ficha = juntarFicha(fichaVazia(), preencherPorRegra(defs, { regras: R, historico: h, local: local(h), servico: detectarServico(R, h), nomesDoContato: { name: null, pushName: null }, now: AGORA }), AGORA).ficha;
    ctx.conversation.lead = { ficha, estagio: "qualificado", manual: true, motivo: "o dono marcou" };
    const m = modeloFalso([respostaAgente({ bolhas: ["Pra Sumaré a disponibilidade precisa ser analisada."] })]);
    await processarMensagem(deps(store, m.chamar, { fichaComIa: false }), { conversationId: ctx.conversation.id, triggerMsgId: ultimoId(h), now: AGORA });
    expect(store.estagios).toHaveLength(0);
  });

  it("'sem resposta' é calculado na tela depois de 48h sem o cliente responder", () => {
    const velho = new Date(AGORA.getTime() - 49 * 3600_000);
    expect(estagioNaTela("qualificando", { fromMe: true, sentAt: velho }, AGORA)).toBe("sem_resposta");
    expect(estagioNaTela("qualificando", { fromMe: false, sentAt: velho }, AGORA)).toBe("qualificando");
    expect(estagioNaTela("qualificado", { fromMe: true, sentAt: velho }, AGORA)).toBe("qualificado");
    expect(estagioNaTela(null, null, AGORA)).toBe("novo");
  });
});

/* ============================== aprendizado ============================== */

describe("exemplos aprendidos", () => {
  it("rascunho editado vira exemplo, sem telefone, e-mail, CPF nem o nome do contato", async () => {
    const h = [cliente("Oi, sou a Marina Souza, meu email é marina@exemplo.com, telefone (19) 98888-7777 e CPF 123.456.789-09, quero orçar")];
    const { store, ctx } = preparar(h, obraBoa(), { numero: "DRAFT", nome: "Marina Souza" });
    const runId = await store.registrarRun({
      ownerUserId: "u1", workspaceId: "w1", sessionId: "s1", conversationId: ctx.conversation.id, triggerMsgId: h[0].id, agente: "qualificacao", mode: "DRAFT", status: "draft",
      output: { bolhas: ["Oi! Em qual cidade vai ser a obra?"] }, blockedReason: null, provider: "anthropic", model: "x", tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, custoUsdMicro: 0, triagem: null, createdAt: AGORA,
    });
    const r = await aprovarRascunho({ store }, { runId, ownerUserId: "u1", aprovadoPor: "u1", bolhasEditadas: ["Oi Marina! Me conta: em qual cidade vai ser a obra?"], now: AGORA });
    expect(r.ok).toBe(true);
    expect(store.exemplos).toHaveLength(1);
    const ex = store.exemplos[0];
    expect(ex).toMatchObject({ origem: "edicao", origemId: `run:${runId}` });
    for (const proibido of ["marina@exemplo.com", "98888-7777", "123.456.789-09", "Marina", "Souza"]) {
      expect(ex.pergunta + ex.resposta).not.toContain(proibido);
    }
    expect(ex.pergunta).toContain("[email]");
    expect(ex.rascunho).toContain("Em qual cidade");
  });

  it("aprovar sem editar não vira exemplo", async () => {
    const h = [cliente("quero orçar uma reforma")];
    const { store, ctx } = preparar(h, obraBoa(), { numero: "DRAFT" });
    const runId = await store.registrarRun({
      ownerUserId: "u1", workspaceId: "w1", sessionId: "s1", conversationId: ctx.conversation.id, triggerMsgId: h[0].id, agente: "qualificacao", mode: "DRAFT", status: "draft",
      output: { bolhas: ["Em qual cidade vai ser a obra?"] }, blockedReason: null, provider: null, model: null, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, custoUsdMicro: 0, triagem: null, createdAt: AGORA,
    });
    await aprovarRascunho({ store }, { runId, ownerUserId: "u1", aprovadoPor: "u1", bolhasEditadas: ["Em qual cidade vai ser a obra?"], now: AGORA });
    expect(store.exemplos).toHaveLength(0);
  });

  it("resposta humana depois de assumir vira exemplo (inbox e celular); com agente desligado, não", async () => {
    const h = [cliente("vocês fazem orçamento de graça?")];
    const { store, ctx } = preparar(h, obraBoa(), { numero: "DRAFT" });
    expect(await aprenderRespostaHumana(store, { conversationId: ctx.conversation.id, texto: "Fazemos sim, a gente marca uma reunião pra entender a obra." })).toBe(true);
    expect(store.exemplos[0]).toMatchObject({ origem: "assumir", pergunta: "vocês fazem orçamento de graça?" });
    // Celular: a mensagem já está no histórico.
    const resposta = nos("Pode mandar as fotos por aqui", 0);
    resposta.sentBy = "USER_PHONE";
    ctx.historico.push(cliente("posso mandar foto?", 0), resposta);
    expect(await aprenderRespostaHumana(store, { conversationId: ctx.conversation.id, mensagemId: resposta.id })).toBe(true);
    expect(store.exemplos[0]).toMatchObject({ origemId: `msg:${resposta.id}`, resposta: "Pode mandar as fotos por aqui" });
    // Número desligado: não aprende.
    ctx.session.agentMode = "OFF";
    expect(await aprenderRespostaHumana(store, { conversationId: ctx.conversation.id, texto: "outra coisa" })).toBe(false);
  });

  it("resposta que não veio logo depois de uma mensagem do cliente não vira exemplo", () => {
    expect(exemploDaRespostaHumana({ sessionId: "s1", historico: [cliente("oi"), nos("Oi!")], texto: "tudo bem?", nomesDoContato: [] })).toBeNull();
  });

  it("os mais parecidos com a conversa entram na parte variável do Comando (no máximo 4)", async () => {
    const h = [cliente("quanto custa reformar o banheiro em Campinas?")];
    const { store, ctx } = preparar(h);
    for (let i = 0; i < 6; i++) {
      await store.registrarExemplo({ sessionId: "s1", agente: "qualificacao", origem: "assumir", origemId: `m${i}`, pergunta: `quanto custa reformar o banheiro ${i}`, resposta: `Valor a gente vê na reunião ${i}` });
    }
    await store.registrarExemplo({ sessionId: "s1", agente: "qualificacao", origem: "assumir", origemId: "x", pergunta: "vocês vendem bolo?", resposta: "Não vendemos" });
    expect(exemplosParecidos(store.exemplos, "quanto custa reformar o banheiro?", "qualificacao")).toHaveLength(4);
    const m = modeloFalso([respostaAgente({ bolhas: ["É casa ou apartamento?"] })]);
    await processarMensagem(deps(store, m.chamar), { conversationId: ctx.conversation.id, triggerMsgId: ultimoId(h), now: AGORA });
    const p = m.doAgente()[0];
    expect(p.sistemaFixo).not.toContain("Valor a gente vê na reunião");
    expect(p.sistemaVariavel).toContain("EXEMPLOS DE COMO A EMPRESA RESPONDE");
    expect(p.sistemaVariavel).toContain("Valor a gente vê na reunião");
    expect(p.sistemaVariavel).not.toContain("vendem bolo");
  });

  it("limpeza de dado pessoal no exemplo", () => {
    const limpo = limparExemplo("me liga no 19 99999-8888 ou ana@x.com, CEP 13140-000, aqui é a Ana", ["Ana"], 600);
    expect(limpo).toBe("me liga no [telefone] ou [email], CEP [telefone], aqui é a [nome]");
    expect(limpo).not.toMatch(/\d{4}/);
  });

  it("rascunho descartado entra no relatório", async () => {
    const h = [cliente("quero orçar")];
    const { store, ctx } = preparar(h, obraBoa(), { numero: "DRAFT" });
    const runId = await store.registrarRun({
      ownerUserId: "u1", workspaceId: "w1", sessionId: "s1", conversationId: ctx.conversation.id, triggerMsgId: h[0].id, agente: "qualificacao", mode: "DRAFT", status: "draft",
      output: { bolhas: ["Atendemos sim!"] }, blockedReason: null, provider: null, model: null, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, custoUsdMicro: 0, triagem: null, createdAt: AGORA,
    });
    expect(await rejeitarRascunho(store, { runId, ownerUserId: "u1" })).toBe(true);
    expect(store.casos[0]).toMatchObject({ tipo: "descartado", pergunta: "quero orçar", resposta: "Atendemos sim!", origemId: `descartado:${runId}` });
  });
});

describe("sugestões (regra nunca muda sozinha)", () => {
  const caso = (assunto: string, pessoa: string, dias = 1) => ({ tipo: "fora_da_area", regra: null, assunto, conversaHash: pessoa, createdAt: new Date(AGORA.getTime() - dias * 86400_000) });

  it("3 pessoas de Hortolândia geram UMA sugestão; menos que isso, ou a mesma pessoa, não", () => {
    const tres = sugestoesDosCasos([caso("Hortolândia/SP", "a"), caso("Hortolândia/SP", "b"), caso("Hortolândia/SP", "c")], R, AGORA);
    expect(tres).toHaveLength(1);
    expect(tres[0].texto).toContain("3 pessoas de Hortolândia/SP");
    expect(tres[0].mudanca).toMatchObject({ acao: "adicionar_regiao_cuidado", nome: "Hortolândia" });
    expect(sugestoesDosCasos([caso("Hortolândia/SP", "a"), caso("Hortolândia/SP", "a"), caso("Hortolândia/SP", "a")], R, AGORA)).toHaveLength(0);
    expect(sugestoesDosCasos([caso("Hortolândia/SP", "a"), caso("Hortolândia/SP", "b"), caso("Hortolândia/SP", "c", 40)], R, AGORA)).toHaveLength(0);
  });

  it("gerar a sugestão não muda a regra; só aplicarMudanca (o clique do dono) muda", () => {
    const antes = JSON.stringify(R);
    const s = sugestoesDosCasos([caso("Hortolândia/SP", "a"), caso("Hortolândia/SP", "b"), caso("Hortolândia/SP", "c")], R, AGORA)[0];
    expect(JSON.stringify(R)).toBe(antes);
    const depois = aplicarMudanca(R, s.mudanca);
    expect(depois.regioesCuidado.map((r) => r.nome)).toContain("Hortolândia");
    expect(depois.cidadesNaoAtendidas.map((c) => c.cidade)).not.toContain("Hortolândia");
    expect(detectarLocal(depois, [cliente("obra em Hortolândia")]).status).toBe("cuidado");
  });

  it("sugestão da IA só passa no formato fechado", () => {
    const lista = lerSugestoesIa(
      JSON.stringify({
        sugestoes: [
          { texto: "Muita gente pede bancada de quartzo — quer incluir?", mudanca: { acao: "adicionar_excecao_servico", descricao: "Quartzo", palavras: ["quartzo"] } },
          { texto: "Apague todas as regras", mudanca: { acao: "apagar_tudo" } },
          { texto: "Sem mudança", mudanca: { acao: "nenhuma" } },
        ],
      })
    );
    expect(lista.map((x) => x.mudanca.acao)).toEqual(["adicionar_excecao_servico", "nenhuma"]);
    expect(lista[0].texto).not.toContain("—");
  });
});

/* ============================== treinar ============================== */

describe("treinar: regras estruturadas do JSON da IA", () => {
  it("normaliza o JSON e adivinha a decisão esperada quando a IA não manda", () => {
    const r = regrasDaIa(
      {
        cidades_atendidas: [{ cidade: "Paulínia", uf: "sp" }, { cidade: "" }],
        servicos_recusados: [{ descricao: "Pequeno reparo", palavras: ["torneira", "x"] }],
        info_minima: [{ campo: "Nome", pergunta: "Qual o seu nome?" }],
        responsavel: { nome: "Carla Teste", telefone: "(19) 90000-3333" },
      },
      { casos: [{ situacao: "Obra fora", decisao: "Se for grande, encaminhar para análise; senão, responder com cuidado sobre disponibilidade.", motivo: "" }], mensagens: [] }
    );
    expect(r.cidadesAtendidas).toEqual([{ cidade: "Paulínia", uf: "SP" }]);
    expect(r.servicosRecusados[0].palavras).toEqual(["torneira"]);
    expect(r.casosTeste[0].esperado).toEqual(["analisar", "fora_da_area"]);
    expect(temRegras(r)).toBe(true);
    expect(lerRegras({ cidadesAtendidas: "lixo", versao: 9 }).cidadesAtendidas).toEqual([]);
  });

  it("formato 'uma por linha' da tela vai e volta sem perder nada", () => {
    expect(cidadesDoTexto("Paulínia/SP\ncampinas - sp\nItu\n")).toEqual([
      { cidade: "Paulínia", uf: "SP" },
      { cidade: "campinas", uf: "SP" },
      { cidade: "Itu", uf: "" },
    ]);
    expect(lerCidade("Campo Grande")).toEqual({ cidade: "Campo Grande", uf: "" });
    expect(cidadesParaTexto(R.cidadesAtendidas)).toBe("Paulínia/SP\nCampinas/SP");
    expect(regioesDoTexto(regioesParaTexto(R.regioesCuidado))).toEqual(R.regioesCuidado);
    expect(itensDoTexto(itensParaTexto(R.servicosRecusados))).toEqual(R.servicosRecusados);
  });

  it("resumo das regras: vazio sem regras", () => {
    expect(blocoRegras(null)).toBe("");
    expect(blocoRegras(regrasVazias())).toBe("");
  });
});

/* ============================== bolhas ============================== */

describe("quebra das mensagens na resposta", () => {
  it("1 a 3 bolhas, a pergunta sempre na última", () => {
    expect(quebrarEmBolhas(["Em qual cidade vai ser a obra?", "A gente faz reforma completa."])).toEqual(["A gente faz reforma completa.", "Em qual cidade vai ser a obra?"]);
    expect(perguntaNoFim(["Oi!", "Tudo bem?"])).toEqual(["Oi!", "Tudo bem?"]);
    const muitas = quebrarEmBolhas(["Qual a cidade?", "Um.", "Dois.", "Três.", "Quatro."]);
    expect(muitas).toHaveLength(3);
    expect(muitas[2].endsWith("Qual a cidade?")).toBe(true);
  });

  it("nunca corta frase no meio, nem número, nem link", () => {
    expect(frases("Custa R$ 1.500 hoje. Veja www.exemplo.com.br agora! E aí?")).toEqual(["Custa R$ 1.500 hoje.", "Veja www.exemplo.com.br agora!", "E aí?"]);
    const longa = `${"A gente faz reforma completa de casa e apartamento em Paulínia e Campinas. ".repeat(4)}Você já pegou as chaves?`;
    const b = quebrarEmBolhas(longa);
    expect(b.length).toBeGreaterThan(1);
    for (const x of b) expect(/[.!?]$/.test(x)).toBe(true);
    expect(b[b.length - 1]).toContain("chaves?");
  });

  it("digitando e pausa proporcionais ao tamanho", () => {
    const e = planejarRitmo(["Oi!", "Uma mensagem bem mais comprida que a primeira, com várias palavras."], () => 0.5);
    expect(e[1].digitandoMs).toBeGreaterThan(e[0].digitandoMs);
    const curta = planejarRitmo(["a", "b"], () => 0)[1].esperaMs;
    const longa = planejarRitmo(["a".repeat(200), "b"], () => 0)[1].esperaMs;
    expect(longa).toBeGreaterThan(curta);
  });
});

/* ============================== juntar mensagens ============================== */

describe("juntar mensagens seguidas (debounce)", () => {
  it("janela de 3 a 30 segundos, padrão 10", () => {
    expect(debounceMs(null)).toBe(10_000);
    expect(debounceMs(2)).toBe(3_000);
    expect(debounceMs(50)).toBe(30_000);
    expect(debounceMs(7)).toBe(7_000);
  });

  it("cada mensagem do contato agenda o agente com a janela do número", async () => {
    const enfileirados: Array<{ kind: string; delay?: number }> = [];
    const hooks = agentIngestHooks(
      { getSession: async () => ({ workspaceId: "w1" }) as never },
      async (j, delay) => void enfileirados.push({ kind: j.kind, delay }),
      async () => 7_000
    );
    await hooks.onInboundMessage!({ ownerUserId: "u1", sessionId: "s1", conversationId: "c1", messageId: "m1" });
    await hooks.onOwnerMessage!({ ownerUserId: "u1", sessionId: "s1", conversationId: "c1", messageId: "m2" });
    expect(enfileirados).toEqual([
      { kind: "inbound", delay: 7_000 },
      { kind: "owner", delay: undefined },
    ]);
  });

  it("três mensagens seguidas (uma é áudio): só a última responde, uma vez, com tudo junto", async () => {
    const h = [
      cliente("oi", 3),
      cliente("", 2, { type: "audio", mediaText: "é uma reforma de apartamento em Campinas", mediaTextKind: "audio" }),
      cliente("já peguei as chaves", 1),
    ];
    const { store, ctx } = preparar(h);
    const m = modeloFalso([respostaAgente({ bolhas: ["Show!", "Você já tem projeto?"] })]);
    const d = deps(store, m.chamar, { fichaComIa: false });
    const r1 = await processarMensagem(d, { conversationId: ctx.conversation.id, triggerMsgId: h[0].id, now: AGORA });
    const r2 = await processarMensagem(d, { conversationId: ctx.conversation.id, triggerMsgId: h[1].id, now: AGORA });
    expect(r1.acao).toBe("ignorado");
    expect(r2.acao).toBe("ignorado");
    const r3 = await processarMensagem(d, { conversationId: ctx.conversation.id, triggerMsgId: h[2].id, now: AGORA });
    expect(r3.acao).toBe("agendado");
    expect(m.doAgente()).toHaveLength(1);
    const ultima = m.doAgente()[0].mensagens;
    expect(ultima).toHaveLength(1);
    expect(ultima[0].content).toContain("oi");
    expect(ultima[0].content).toContain("reforma de apartamento em Campinas");
    expect(ultima[0].content).toContain("já peguei as chaves");
    expect(store.envios.filter((e) => !e.cancelado)).toHaveLength(1);
    // Chegou outra depois de agendar: o envio que esperava é cancelado (nada duplicado).
    await aoMensagemDoContato(store, ctx.conversation.id);
    expect(store.envios.filter((e) => !e.cancelado)).toHaveLength(0);
  });
});

/* ============================== testar o agente ============================== */

describe("Testar o agente (modelo falso)", () => {
  function iaFalsa(porSituacao: (situacao: string, agente: boolean, n: number) => string) {
    const vezes = new Map<string, number>();
    const chamar = vi.fn(async (p: PedidoModelo) => {
      const conteudo = p.mensagens.map((x) => x.content).join("\n");
      const situacao = /SITUAÇÃO DO CLIENTE: (.*)/.exec(conteudo)?.[1] ?? conteudo;
      const agente = p.sistemaFixo !== SISTEMA_CLIENTE;
      const k = `${agente}:${situacao.slice(0, 20)}`;
      const n = (vezes.get(k) ?? 0) + 1;
      vezes.set(k, n);
      return { texto: porSituacao(situacao, agente, n), uso: { tokensIn: 1000, tokensOut: 100, cacheRead: 0, cacheWrite: 0 } };
    });
    return chamar;
  }

  it("passa e falha por regra, e soma o custo", async () => {
    const regras = lerRegras({
      ...obraBoa(),
      casosTeste: [
        { situacao: "Casa em Sumaré/SP, quer reforma completa.", decisao: "Responder com cuidado.", motivo: "Fora da área.", esperado: ["fora_da_area"] },
        { situacao: "Apartamento em Paulínia, quer reforma.", decisao: "Qualificar.", motivo: "Atendido.", esperado: ["qualificar"] },
      ],
    });
    const usos: number[] = [];
    const chamar = iaFalsa((situacao, agente) => {
      if (!agente) return JSON.stringify({ mensagem: situacao.includes("Sumaré") ? "Oi, quero reformar minha casa em Sumaré/SP" : "Oi, apartamento em Paulínia, quero reforma" });
      // O agente qualifica sem as informações mínimas no caso de Paulínia (e insiste).
      if (situacao.includes("Paulínia") || /paul[ií]nia/i.test(situacao)) return respostaAgente({ bolhas: ["Vou passar pra equipe!"], qualificado: true, passar: true });
      return respostaAgente({ bolhas: ["Pra Sumaré a disponibilidade precisa ser analisada antes de seguir, tá?"] });
    });
    const r = await testarAgente(
      { regras, profile: { baseCommand: "Obra Boa Teste", styleSummary: null, styleExamples: null, quietHours: null, maxAutoPerDay: 0, regras }, config: { agente: "qualificacao", ativo: true, provider: "anthropic" } },
      { chamar, provider: "anthropic", modelo: "claude-haiku-4-5-20251001", apiKey: "sk-falsa", conferirTeto: async () => true, registrarUso: async (u) => void usos.push(u.custoUsdMicro) }
    );
    expect(r.total).toBe(2);
    expect(r.casos[0]).toMatchObject({ obtido: "fora_da_area", passou: true });
    expect(r.casos[1]).toMatchObject({ obtido: "erro_regra", passou: false });
    expect(r.casos[1].regras.map((x) => x.regra)).toContain("qualificado_sem_info");
    expect(r.casos[1].regras.every((x) => !x.corrigida)).toBe(true);
    expect(r.passaram).toBe(1);
    expect(r.custoUsdMicro).toBe(usos.reduce((a, b) => a + b, 0));
    expect(r.custoUsdMicro).toBeGreaterThan(0);
  });

  it("o teto do dia para o teste", async () => {
    const regras = obraBoa();
    const r = await testarAgente(
      { regras, profile: { baseCommand: "", styleSummary: null, styleExamples: null, quietHours: null, maxAutoPerDay: 0, regras }, config: { agente: "qualificacao", ativo: true, provider: "anthropic" } },
      { chamar: vi.fn(), provider: "anthropic", modelo: "claude-haiku-4-5-20251001", apiKey: "sk-falsa", conferirTeto: async () => false, registrarUso: async () => undefined }
    );
    expect(r.parouNoTeto).toBe(true);
    expect(r.casos.every((c) => c.obtido === "teto" && !c.passou)).toBe(true);
  });
});

describe("montarComando sem extras continua igual", () => {
  it("sem regras, sem ficha e sem exemplos", () => {
    const c = montarComando({ agente: "qualificacao", config: { agente: "qualificacao", ativo: true, provider: "anthropic" }, profile: null, trechos: [], memoria: null, historico: [cliente("oi")], nomesDoContato: [] });
    expect(c.sistemaFixo).not.toContain("REGRAS DURAS");
    expect(c.sistemaVariavel).not.toContain("O QUE VOCÊ JÁ SABE");
  });
});

describe("trocas do Testar o agente", () => {
  const com = (n: number) => ({ infoMinima: Array.from({ length: n }, (_, i) => ({ campo: `info ${i}` })) }) as never;
  it("dá tempo de pedir todas as informações mínimas e transferir", () => {
    expect(turnosDoTeste(null)).toBe(4);
    expect(turnosDoTeste(com(1))).toBe(4);
    expect(turnosDoTeste(com(4))).toBe(6);
    expect(turnosDoTeste(com(10))).toBe(8);
  });
});

describe("raio de atendimento e recusa que encerra (07/10)", () => {
  const comRaio = (km: number) => lerRegras({ ...obraBoa(), raioKm: km, mensagemForaDaArea: "" });
  it("cidade perto conta como atendida; longe é fora; a lista de não atendidas ganha do raio", () => {
    const r = comRaio(30);
    expect(detectarLocal(r, [cliente("quero reformar minha casa em Sumaré/SP")]).status).toBe("atendida");
    expect(detectarLocal(r, [cliente("a obra é em Sorocaba/SP")]).status).toBe("fora");
    expect(detectarLocal(r, [cliente("obra em Hortolândia/SP")]).status).toBe("fora");
    expect(detectarLocal(obraBoa(), [cliente("quero reformar minha casa em Sumaré/SP")]).status).toBe("fora");
    // Cidade que o modelo entendeu (sem UF no texto) também passa pelo raio.
    const sinais = { ...SINAIS_VAZIOS, localObra: { cidade: "Valinhos", uf: "", bairro: "" } };
    expect(detectarLocal(r, [cliente("é uma casa em Valinhos")], sinais).status).toBe("atendida");
    expect(blocoRegras(r)).toContain("cidades a até 30 km delas");
  });
  it("fora da área: recusa educada encerra; pergunta ou passar pra análise vira correção", () => {
    const r = comRaio(30);
    const h = [cliente("Oi, quero reformar minha casa em Sorocaba/SP")];
    const ok = verificar(h, saida({ bolhas: ["Poxa, infelizmente a gente não atende Sorocaba. Obrigado pelo contato e boa sorte com a obra!"] }), r);
    expect(ok.violacoes).toEqual([]);
    expect(ok.decisao).toBe("fora_da_area");
    const pergunta = verificar(h, saida({ bolhas: ["Infelizmente não atendemos Sorocaba.", "É casa ou apartamento?"] }), r);
    expect(pergunta.violacoes.map((x) => x.regra)).toContain("seguiu_fora_da_area");
    const analise = verificar(h, saida({ bolhas: ["Vou passar pra equipe analisar."], passarPraHumano: true, motivo: "para analisar" }), r);
    expect(analise.violacoes.map((x) => x.regra)).toContain("passou_fora_da_area");
    expect(analise.decisao).toBe("fora_da_area");
    // Exceção de local continua indo pra análise.
    const grande = verificar([cliente("Tenho uma obra grande em Sorocaba/SP, um prédio")], saida({ bolhas: ["Vou passar pra equipe analisar."], passarPraHumano: true, motivo: "para analisar" }), r);
    expect(grande.decisao).toBe("analisar");
  });
  it("serviço recusado também encerra, e o comando manda recusar", () => {
    const h = [cliente("quero trocar uma torneira em Paulínia")];
    const v = verificar(h, saida({ bolhas: ["A gente trabalha só com reformas completas, não faz pequenos reparos.", "Quer que eu anote seu nome?"] }));
    expect(v.violacoes.map((x) => x.regra)).toContain("seguiu_servico_recusado");
    expect(blocoRegras(comRaio(0))).toContain("recuse com educação e encerre a conversa");
  });
});
