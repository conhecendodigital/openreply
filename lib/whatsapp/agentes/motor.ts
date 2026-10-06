/**
 * Motor dos 3 agentes (qualificação, atendimento, suporte).
 *
 * Roda no worker (fila wa-agent), nunca no gateway. Para cada mensagem nova do
 * contato:
 *   travas baratas (grupo, janela de 24h, modo, takeover)
 *   -> triagem (regras + Jev)
 *   -> teto de gasto
 *   -> cérebro + memória + tom -> modelo (Haiku 4.5 / GPT-5 mini; Sonnet 5 se difícil)
 *   -> travas de conteúdo (preço/prazo/link inventado) + checagem do Jev
 *   -> RASCUNHO (padrão) ou envio agendado com ritmo humano (só se ligado na conversa/etiqueta)
 *
 * O envio de verdade é do conector: ele chama podeEnviar() antes de cada bolha,
 * então "Assumir" segura até um envio que já estava na fila.
 */
import { createHash } from "node:crypto";
import { temRegras, type RegrasNegocio } from "@/lib/whatsapp/regras/esquema";
import { detectarServico } from "@/lib/whatsapp/regras/detectar";
import { classificarLead, decidirMudanca } from "@/lib/whatsapp/regras/estagio";
import { exemploDaEdicao, exemploDaRespostaHumana, exemplosParecidos, limparExemplo, MAX_PERGUNTA, MAX_RESPOSTA, perguntaAntes, textoExemplos } from "@/lib/whatsapp/regras/exemplos";
import {
  camposDaFicha,
  conferirExtracao,
  fichaVazia,
  juntarFicha,
  lerSaidaFicha,
  MAX_TOKENS_FICHA,
  mensagemFicha,
  preencherPorRegra,
  resumoDaFicha,
  SISTEMA_FICHA,
  type CampoFichaDef,
  type FichaLead,
} from "@/lib/whatsapp/regras/ficha";
import { blocoFicha, blocoRegras, formatoExtra } from "@/lib/whatsapp/regras/prompt";
import { normalizarTexto } from "@/lib/whatsapp/regras/texto";
import { avisoDasViolacoes, localDaConversa, mensagemDeCorrecaoRegras, verificarResposta, type Verificacao, type Violacao } from "@/lib/whatsapp/regras/verificar";
import { duracaoTotalMs, planejarRitmo, quebrarEmBolhas, type Sorteio } from "./bolhas";
import { lerSaida, montarComando, textoPlano, type ComandoMontado, type SaidaAgente } from "./comando";
import { abrirChave } from "./credenciais";
import { descreverInventadas, afirmacoesInventadas } from "./guardas";
import { PERGUNTAS_CHECAR, perguntarJev, type JevOpcoes } from "./jev";
import { custoMaximoUsdMicro, custoUsdMicro, escolherModelo, type Preco } from "./modelos";
import { janelaAberta, resolverModo, takeoverAtivo, TAKEOVER_HORAS_PADRAO } from "./modo";
import { chamarModelo, ErroModelo, type ChamarModelo, type RespostaModelo } from "./provedores";
import { autoEnviosHoje, conferirTeto, emSilencio, limitesDoAmbiente, mensagemTeto } from "./teto";
import { triar, ultimaDoContato, type DecisaoTriagem } from "./triagem";
import type { AgenteConfig, AgenteTipo, AgentRunRecord, AgentStore, AiCredentialRecord, BrainRetriever, ConversaContexto, IaProvider, Limites, RunStatus, Uso } from "./types";

export const MAX_TOKENS_SAIDA = 600;

export interface DepsMotor {
  store: AgentStore;
  cerebro: BrainRetriever;
  jev?: JevOpcoes;
  chamar?: ChamarModelo;
  limites?: Limites;
  rng?: Sorteio;
  /** Tabela de preços (a do /admin). Sem ela, a tabela fixa de modelos.ts. */
  precos?: Record<string, Preco>;
  /**
   * Cada chamada paga ao modelo (ou barrada pelo teto), pro relatório de gastos
   * de IA (lib/ai/usage.ts recordAiUsage). Erro aqui nunca derruba o motor.
   */
  registrarUso?: (uso: {
    ownerUserId: string;
    workspaceId: string;
    conversationId: string;
    contactId: string;
    agente: AgenteTipo;
    provider: IaProvider;
    modelo: string;
    uso: Uso;
    runId: string | null;
    bloqueado: boolean;
    /** agent (padrão) | ficha (atualização da ficha do lead, modelo barato). */
    kind?: "agent" | "ficha";
  }) => Promise<void>;
  /** false = a ficha do lead só usa regra (sem a chamada barata de IA). */
  fichaComIa?: boolean;
  /** Avisa o usuário (sino, e-mail). Opcional. */
  notificar?: (aviso: { ownerUserId: string; conversationId: string; tipo: "handoff" | "teto" | "erro_chave"; mensagem: string }) => Promise<void>;
}

export type ResultadoMotor =
  | { acao: "ignorado"; motivo: string; runId?: string }
  | { acao: "humano"; motivo: string; runId: string }
  | { acao: "rascunho"; runId: string; bolhas: string[]; alerta: string | null }
  | { acao: "agendado"; runId: string; jobId: string; bolhas: string[] }
  | { acao: "erro"; motivo: string; runId?: string };

const LIMIAR_CHECAGEM = 0.65;

export async function processarMensagem(
  deps: DepsMotor,
  input: { conversationId: string; triggerMsgId: string; now?: Date }
): Promise<ResultadoMotor> {
  const now = input.now ?? new Date();
  const { store } = deps;
  const ctx = await store.carregarContexto(input.conversationId);
  if (!ctx) return { acao: "ignorado", motivo: "conversa não encontrada" };
  if (ctx.contact.isGroup) return { acao: "ignorado", motivo: "o agente não responde grupo" };

  const ultima = ultimaDoContato(ctx.historico);
  const ultimaGeral = ctx.historico[ctx.historico.length - 1];
  if (!ultima || ultimaGeral?.fromMe) return { acao: "ignorado", motivo: "a última mensagem não é do contato" };
  if (ultima.id !== input.triggerMsgId) return { acao: "ignorado", motivo: "chegou mensagem mais nova; ela vai ser tratada no lugar" };
  if (!janelaAberta(ultima.sentAt, now)) return { acao: "ignorado", motivo: "fora da janela de 24h da última mensagem do contato" };

  const modo = resolverModo(ctx, now);
  if (modo.modo === "OFF") return { acao: "ignorado", motivo: modo.motivo };

  const configs = await store.configAgentes(ctx.ownerUserId, ctx.session.id);
  if (!configs.some((c) => c.ativo)) return { acao: "ignorado", motivo: "nenhum agente ligado nesse número" };

  const base: Omit<AgentRunRecord, "status"> = {
    ownerUserId: ctx.ownerUserId,
    workspaceId: ctx.workspaceId,
    sessionId: ctx.session.id,
    conversationId: ctx.conversation.id,
    triggerMsgId: ultima.id,
    agente: null,
    mode: modo.modo,
    output: null,
    blockedReason: null,
    provider: null,
    model: null,
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    cacheWrite: 0,
    custoUsdMicro: 0,
    triagem: null,
    createdAt: now,
  };
  // Depois da reserva do teto (passo 4) o run já existe: os próximos registros atualizam a mesma linha.
  let runReservado: string | null = null;
  const registrar = async (status: RunStatus, extra: Partial<AgentRunRecord>): Promise<string> => {
    if (runReservado) {
      await store.atualizarRun(runReservado, { ...base, ...extra, status });
      return runReservado;
    }
    return store.registrarRun({ ...base, ...extra, status });
  };

  // 1. Triagem
  const tri: DecisaoTriagem = await triar(ctx.historico, configs, deps.jev);
  base.triagem = tri;
  base.agente = tri.agente;
  if (tri.acao === "nao_precisa" || tri.acao === "spam") {
    const runId = await registrar("skipped", { blockedReason: tri.motivo });
    return { acao: "ignorado", motivo: tri.motivo, runId };
  }
  if (tri.acao === "humano") return passarPraHumano(deps, ctx.ownerUserId, ctx.conversation.id, now, registrar, tri.motivo);

  // 2. Modelo e chave
  const config = configs.find((c) => c.agente === tri.agente && c.ativo) ?? configs.find((c) => c.ativo)!;
  base.agente = config.agente;
  const escolha = escolherModelo(config, tri, deps.precos);
  base.provider = escolha.provider;
  base.model = escolha.modelo;
  const cred = await store.credencialAtiva(ctx.ownerUserId, escolha.provider);
  if (!cred) {
    const motivo = `Falta a chave de API ${escolha.provider === "anthropic" ? "da Anthropic (Claude)" : "da OpenAI"} nas configurações do agente.`;
    const runId = await registrar("error", { blockedReason: motivo });
    await deps.notificar?.({ ownerUserId: ctx.ownerUserId, conversationId: ctx.conversation.id, tipo: "erro_chave", mensagem: motivo });
    return { acao: "erro", motivo, runId };
  }

  const limites = deps.limites ?? limitesDoAmbiente();
  // 3a. Teto já estourado: nem busca no cérebro (a busca gasta embedding com a chave do dono).
  const tetoAntes = await conferirTeto(
    store,
    { ownerUserId: ctx.ownerUserId, workspaceId: ctx.workspaceId, dailyCap: cred.dailyCap, custoPrevistoUsdMicro: 1, now, timeZone: ctx.profile?.timeZone },
    limites
  );
  if (!tetoAntes.ok) {
    const motivo = mensagemTeto(tetoAntes.motivo);
    const runId = await registrar("blocked", { blockedReason: motivo });
    await deps.notificar?.({ ownerUserId: ctx.ownerUserId, conversationId: ctx.conversation.id, tipo: "teto", mensagem: motivo });
    return { acao: "ignorado", motivo, runId };
  }

  // 3a. Ficha do lead (regras duras): por regra, e um modelo barato pro que falta (com evidência).
  const regrasPerfil = ctx.profile?.regras ?? null;
  const regras = temRegras(regrasPerfil) ? regrasPerfil : null;
  const defs = camposDaFicha(regrasPerfil);
  const nomesContato = [ctx.contact.name, ctx.contact.pushName].filter((n): n is string => Boolean(n));
  const leadAtual = ctx.conversation.lead ?? { ficha: fichaVazia(), estagio: null, manual: false, motivo: null };
  let ficha = leadAtual.ficha;
  let fichaMudou = false;
  if (defs.length && regrasPerfil) {
    const r = await atualizarFicha(deps, ctx, { regras: regrasPerfil, defs, ficha: leadAtual.ficha, config, cred, limites, now });
    ficha = r.ficha;
    fichaMudou = r.mudou;
  }

  // 3. Contexto: cérebro + memória + tom + exemplos aprendidos
  const consulta = ctx.historico
    .filter((m) => !m.fromMe)
    .slice(-3)
    .map((m) => textoPlano(m).slice(0, 1500))
    .join("\n");
  const [trechos, memoria, aprendidos] = await Promise.all([
    deps.cerebro
      .buscar({ ownerUserId: ctx.ownerUserId, sessionId: ctx.session.id, agente: config.agente, consulta, limite: 6 })
      .catch(() => []),
    store.lerMemoria(ctx.contact.id),
    store.exemplosAprendidos ? store.exemplosAprendidos(ctx.session.id).catch(() => []) : Promise.resolve([]),
  ]);
  const exemplos = exemplosParecidos(aprendidos, consulta, config.agente);
  const fb = blocoFicha(ficha, defs);
  const comando = montarComando({
    agente: config.agente,
    config,
    profile: ctx.profile,
    trechos,
    memoria,
    historico: ctx.historico,
    nomesDoContato: nomesContato,
    extras: {
      regras: blocoRegras(regrasPerfil, ctx.profile?.baseCommand ?? ""),
      formato: formatoExtra(regrasPerfil),
      sabe: fb.sabe,
      falta: regras ? fb.falta : "",
      exemplos: exemplos.length ? textoExemplos(exemplos) : "",
    },
  });

  // 4. Teto (pior caso antes de gastar)
  const caracteres = comando.sistemaFixo.length + comando.sistemaVariavel.length + comando.mensagens.reduce((s, m) => s + m.content.length, 0);
  const custoPrevisto = custoMaximoUsdMicro(escolha.modelo, caracteres, MAX_TOKENS_SAIDA, deps.precos);
  const teto = await conferirTeto(
    store,
    {
      ownerUserId: ctx.ownerUserId,
      workspaceId: ctx.workspaceId,
      dailyCap: cred.dailyCap,
      custoPrevistoUsdMicro: custoPrevisto,
      now,
      timeZone: ctx.profile?.timeZone,
    },
    limites
  );
  if (!teto.ok) {
    const motivo = mensagemTeto(teto.motivo);
    const runId = await registrar("blocked", { blockedReason: motivo });
    await usar(deps, ctx, config.agente, escolha.provider, escolha.modelo, { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0 }, runId, true);
    await deps.notificar?.({ ownerUserId: ctx.ownerUserId, conversationId: ctx.conversation.id, tipo: "teto", mensagem: motivo });
    return { acao: "ignorado", motivo, runId };
  }
  // Reserva o pior caso ANTES de chamar o modelo: duas mensagens processadas ao
  // mesmo tempo passavam as duas pelo teto (o gasto só era gravado depois da
  // resposta). O run "pending" entra no gastoDoDia e é trocado pelo custo real.
  // No store Prisma, conferirTeto + esta reserva devem rodar sob
  // pg_advisory_xact_lock(hashtext(ownerUserId)) pra fechar a corrida de vez.
  runReservado = await store.registrarRun({ ...base, status: "pending", custoUsdMicro: custoPrevisto });

  // 5. Modelo
  let resposta;
  try {
    resposta = await (deps.chamar ?? chamarModelo)({
      provider: escolha.provider,
      modelo: escolha.modelo,
      apiKey: abrirChave(cred),
      sistemaFixo: comando.sistemaFixo,
      sistemaVariavel: comando.sistemaVariavel,
      mensagens: comando.mensagens,
      maxTokens: MAX_TOKENS_SAIDA,
      chaveCache: `wa-${ctx.session.id}-${config.agente}`,
    });
  } catch (e) {
    const motivo = e instanceof ErroModelo ? e.message : "Erro inesperado ao chamar a IA.";
    const runId = await registrar("error", { blockedReason: motivo });
    if (e instanceof ErroModelo && (e.codigo === "chave_invalida" || e.codigo === "sem_saldo")) {
      await deps.notificar?.({ ownerUserId: ctx.ownerUserId, conversationId: ctx.conversation.id, tipo: "erro_chave", mensagem: motivo });
    }
    return { acao: "erro", motivo, runId };
  }
  Object.assign(base, {
    tokensIn: resposta.uso.tokensIn,
    tokensOut: resposta.uso.tokensOut,
    cacheRead: resposta.uso.cacheRead,
    cacheWrite: resposta.uso.cacheWrite,
    custoUsdMicro: custoUsdMicro(escolha.modelo, resposta.uso, deps.precos),
  });
  await usar(deps, ctx, config.agente, escolha.provider, escolha.modelo, resposta.uso, runReservado, false);

  let saida: SaidaAgente | null = lerSaida(resposta.texto);
  if (!saida) {
    const runId = await registrar("error", { blockedReason: "A IA devolveu uma resposta fora do formato." });
    return { acao: "erro", motivo: "resposta fora do formato", runId };
  }

  // 5b. Regras duras: confere por regra; se quebrou, pede UMA correção; se continuar errada, vira rascunho com o aviso.
  let verificacao: Verificacao | null = null;
  let alertaRegra: string | null = null;
  const conversaHash = hashConversa(ctx.conversation.id);
  const perguntaCliente = limparExemplo(perguntaAntes(ctx.historico, ctx.historico.length), nomesContato, MAX_PERGUNTA);
  if (regras) {
    const verificar = (s: SaidaAgente) =>
      verificarResposta({ regras, agente: config.agente, historico: ctx.historico, saida: { ...s, bolhas: quebrarEmBolhas(s.bolhas) }, ficha, defs, nomesDoContato: nomesContato });
    verificacao = verificar(saida);
    if (verificacao.violacoes.length) {
      const primeiras = verificacao.violacoes;
      const corr = await corrigirUmaVez(deps, ctx, { escolha, cred, limites, comando, textoAnterior: resposta.texto, violacoes: primeiras, now, agente: config.agente, runId: runReservado });
      if (corr) {
        Object.assign(base, {
          tokensIn: base.tokensIn + corr.uso.tokensIn,
          tokensOut: base.tokensOut + corr.uso.tokensOut,
          cacheRead: base.cacheRead + corr.uso.cacheRead,
          cacheWrite: base.cacheWrite + corr.uso.cacheWrite,
          custoUsdMicro: base.custoUsdMicro + custoUsdMicro(escolha.modelo, corr.uso, deps.precos),
        });
        const s2 = lerSaida(corr.texto);
        if (s2) {
          saida = s2;
          verificacao = verificar(s2);
        }
      }
      const codigos = (v: Violacao[]) => [...new Set(v.map((x) => x.regra))].join(",");
      if (verificacao.violacoes.length) {
        alertaRegra = avisoDasViolacoes(verificacao.violacoes);
        await caso(store, { sessionId: ctx.session.id, tipo: "regra_bloqueou", regra: codigos(verificacao.violacoes), assunto: verificacao.local.cidade, pergunta: perguntaCliente, resposta: limparExemplo(saida.bolhas.join("\n"), nomesContato, MAX_RESPOSTA), conversaHash, origemId: `bloqueou:${input.triggerMsgId}` });
      } else {
        await caso(store, { sessionId: ctx.session.id, tipo: "regra_corrigiu", regra: codigos(primeiras), assunto: verificacao.local.cidade, pergunta: perguntaCliente, conversaHash, origemId: `corrigiu:${input.triggerMsgId}` });
      }
    }
    if (verificacao.local.status === "fora" && verificacao.local.cidade && !verificacao.excecaoLocal) {
      await caso(store, { sessionId: ctx.session.id, tipo: "fora_da_area", assunto: verificacao.local.cidade, pergunta: perguntaCliente, conversaHash, origemId: `fora:${conversaHash}:${normalizarTexto(verificacao.local.cidade)}` });
    }
    if (verificacao.servico.status === "recusado") {
      const assunto = verificacao.servico.termo ?? verificacao.servico.descricao ?? "serviço recusado";
      await caso(store, { sessionId: ctx.session.id, tipo: "servico_recusado", assunto, pergunta: perguntaCliente, conversaHash, origemId: `servico:${conversaHash}:${normalizarTexto(assunto)}` });
    }
  }

  // 5c. Estágio do lead no CRM (regras + ficha; sem regra, o que o agente disse).
  const resumoFicha = defs.length ? resumoDaFicha(ficha, defs) : "";
  const classificacao = classificarLead({
    regras: regrasPerfil,
    verificacao,
    agente: config.agente,
    qualificadoPeloModelo: !regras && saida.qualificado,
    resumoQualificado: resumoFicha ? resumoFicha.replace(/\n/g, "; ") : saida.resumoEquipe.slice(0, 300),
  });
  const mudanca = decidirMudanca(leadAtual, classificacao, fichaMudou);
  if (mudanca && store.salvarEstagio) {
    await store
      .salvarEstagio({ conversationId: ctx.conversation.id, sessionId: ctx.session.id, de: leadAtual.estagio, nova: mudanca, manual: false, porUserId: null })
      .catch(() => undefined);
  }

  if (regras && verificacao && !alertaRegra) {
    // Quem decide se transfere é a regra, não o modelo.
    const d = verificacao.decisao;
    saida = {
      ...saida,
      passarPraHumano: d === "qualificar" || d === "analisar" || d === "humano",
      qualificado: d === "qualificar",
      motivo: d === "analisar" ? `para analisar: ${verificacao.motivo}` : saida.motivo,
    };
  }
  const bolhas = alertaRegra ? bolhasDoRascunho(saida, verificacao, defs) : quebrarEmBolhas(saida.bolhas);
  if (!alertaRegra && (saida.passarPraHumano || bolhas.length === 0)) {
    // 2026-10-06 (Matheus): transfere quando o lead fica qualificado (ou pede uma
    // pessoa, ou um caso vai pra análise); o resumo da ficha vai no motivo e no aviso.
    let motivoHumano = saida.qualificado
      ? `lead qualificado${resumoFicha ? `: ${resumoFicha.replace(/\n/g, "; ")}` : saida.resumoEquipe ? `: ${saida.resumoEquipe}` : ""}`
      : saida.motivo || "o agente não soube responder";
    if (saida.qualificado) motivoHumano += await avisarResponsavel(store, ctx, resumoFicha || saida.resumoEquipe);
    const resultado = await passarPraHumano(deps, ctx.ownerUserId, ctx.conversation.id, now, registrar, motivoHumano.slice(0, 1500), {
      bolhas,
      motivo: saida.motivo,
    });
    // No automático, a mensagem de encaminhamento ainda sai pro cliente (aprovada
    // pelo sistema, então passa pela pausa) e depois o agente fica parado ali.
    if (modo.modo === "AUTO" && bolhas.length > 0) {
      const atraso = ctx.profile?.atrasoInicialMs;
      const envios = planejarRitmo(bolhas, deps.rng, atraso ? { esperaInicialMinMs: atraso.min, esperaInicialMaxMs: atraso.max } : {});
      if (janelaAberta(ultima.sentAt, now, duracaoTotalMs(envios))) {
        const runId = await store.registrarRun({ ...base, status: "scheduled", output: { bolhas, motivo: saida.motivo || null } });
        await store.atualizarRun(runId, { approvedBy: "sistema:encaminhamento" });
        try {
          await store.agendarEnvio({ runId, conversationId: ctx.conversation.id, sessionId: ctx.session.id, envios });
        } catch {
          await store.atualizarRun(runId, { status: "draft", blockedReason: "Não deu pra agendar a mensagem de encaminhamento; ficou como rascunho." });
        }
      }
    }
    return resultado;
  }
  const output = { bolhas, motivo: saida.motivo || null };

  // 6. Travas de conteúdo e checagem do Jev
  const alertas: string[] = alertaRegra ? [alertaRegra] : [];
  const inventadas = afirmacoesInventadas(bolhas.join("\n"), comando.fontesPermitidas);
  if (inventadas.length) alertas.push(descreverInventadas(inventadas));
  const checagem = await perguntarJev({ ultima_mensagem_do_cliente: textoPlano(ultima).slice(0, 1500), resposta: bolhas.join("\n") }, PERGUNTAS_CHECAR, deps.jev);
  if (checagem.ok) {
    const sim = (k: string) => {
      const r = checagem.respostas[k];
      return r?.tipo === "noul" ? r.sim : 0.5;
    };
    if (sim("cara_ia") >= LIMIAR_CHECAGEM) alertas.push("A resposta parece escrita por robô. Ajuste o tom antes de enviar.");
    if (sim("guru") >= LIMIAR_CHECAGEM) alertas.push("A resposta promete demais. Confira antes de enviar.");
    if (sim("responde") <= 1 - LIMIAR_CHECAGEM) alertas.push("A resposta talvez não responda o que o cliente perguntou.");
  } else if (modo.modo === "AUTO" && checagem.erro !== "sem_chave") {
    // Jev fora do ar (não desligado de propósito): melhor rascunho.
    alertas.push("Não deu pra conferir a resposta agora, então ela ficou como rascunho.");
  }

  await store.salvarMemoria(ctx.contact.id, ctx.ownerUserId, {
    resumo: memoria?.resumo ?? null,
    fatos: memoria?.fatos ?? [],
    ultimoAgente: config.agente,
    atualizadoEm: now,
  });

  // 7. Rascunho ou envio
  // Triagem incerta (Jev fora do ar ou em dúvida) nunca sai sozinha: vira rascunho.
  if (modo.modo === "AUTO" && tri.incerto) alertas.push("A triagem ficou em dúvida, então a resposta ficou como rascunho.");
  let motivoRascunho: string | null = alertas.length ? alertas.join(" ") : null;
  if (modo.modo === "AUTO" && !motivoRascunho) {
    if (emSilencio(now, ctx.profile?.quietHours, ctx.profile?.timeZone)) motivoRascunho = "Horário de silêncio: ficou como rascunho.";
    else if ((await autoEnviosHoje(store, ctx.session.id, now, ctx.profile?.timeZone)) >= (ctx.profile?.maxAutoPerDay ?? 50)) {
      motivoRascunho = mensagemTeto("limite_auto");
    }
  }
  if (modo.modo === "AUTO" && !motivoRascunho) {
    const atraso = ctx.profile?.atrasoInicialMs;
    const envios = planejarRitmo(bolhas, deps.rng, atraso ? { esperaInicialMinMs: atraso.min, esperaInicialMaxMs: atraso.max } : {});
    if (!janelaAberta(ultima.sentAt, now, duracaoTotalMs(envios))) {
      motivoRascunho = "A janela de 24h fecha antes do envio terminar.";
    } else {
      const runId = await registrar("scheduled", { output });
      try {
        const jobId = await store.agendarEnvio({ runId, conversationId: ctx.conversation.id, sessionId: ctx.session.id, envios });
        return { acao: "agendado", runId, jobId, bolhas };
      } catch {
        await store.atualizarRun(runId, { status: "draft", blockedReason: "Não deu pra agendar o envio; ficou como rascunho." });
        return { acao: "rascunho", runId, bolhas, alerta: "Não deu pra agendar o envio; ficou como rascunho." };
      }
    }
  }
  const runId = await registrar("draft", { output, blockedReason: motivoRascunho });
  return { acao: "rascunho", runId, bolhas, alerta: motivoRascunho };
}

async function usar(
  deps: DepsMotor,
  ctx: { ownerUserId: string; workspaceId: string; conversation: { id: string }; contact: { id: string } },
  agente: AgenteTipo,
  provider: IaProvider,
  modelo: string,
  uso: Uso,
  runId: string | null,
  bloqueado: boolean,
  kind: "agent" | "ficha" = "agent"
) {
  if (!deps.registrarUso) return;
  try {
    await deps.registrarUso({
      ownerUserId: ctx.ownerUserId,
      workspaceId: ctx.workspaceId,
      conversationId: ctx.conversation.id,
      contactId: ctx.contact.id,
      agente,
      provider,
      modelo,
      uso,
      runId,
      bloqueado,
      kind,
    });
  } catch {
    // O relatório não pode derrubar a resposta.
  }
}

function hashConversa(conversationId: string): string {
  return createHash("sha256").update(`wa-conversa:${conversationId}`).digest("hex").slice(0, 16);
}

async function caso(store: AgentStore, c: Parameters<NonNullable<AgentStore["registrarCaso"]>>[0]) {
  if (!store.registrarCaso) return;
  try {
    await store.registrarCaso(c);
  } catch {
    // O relatório não pode derrubar a resposta.
  }
}

/** Rascunho quando a regra continuou quebrada: a pergunta certa, se a regra diz qual é. */
function bolhasDoRascunho(saida: SaidaAgente, v: Verificacao | null, defs: CampoFichaDef[]): string[] {
  const codigos = new Set(v?.violacoes.map((x) => x.regra) ?? []);
  const perguntaLocal = defs.find((d) => d.tipo === "cidade")?.pergunta;
  if (codigos.has("qualificado_sem_local") || codigos.has("nao_perguntou_local")) {
    return [perguntaLocal && perguntaLocal.trim().endsWith("?") ? perguntaLocal.trim() : "Em qual cidade vai ser o serviço?"];
  }
  if (codigos.has("qualificado_sem_info") && v?.faltando[0]?.pergunta?.trim().endsWith("?")) return [v.faltando[0].pergunta.trim()];
  const b = quebrarEmBolhas(saida.bolhas);
  return b.length ? b : ["(o agente não escreveu uma resposta que siga as regras; escreva você)"];
}

/** Uma correção só, com a regra explicada. null = teto, erro ou sem resposta. */
async function corrigirUmaVez(
  deps: DepsMotor,
  ctx: ConversaContexto,
  e: {
    escolha: { provider: IaProvider; modelo: string };
    cred: AiCredentialRecord;
    limites: Limites;
    comando: ComandoMontado;
    textoAnterior: string;
    violacoes: Violacao[];
    now: Date;
    agente: AgenteTipo;
    runId: string | null;
  }
): Promise<RespostaModelo | null> {
  const mensagens = [
    ...e.comando.mensagens,
    { role: "assistant" as const, content: e.textoAnterior.slice(0, 4000) || "{}" },
    { role: "user" as const, content: mensagemDeCorrecaoRegras(e.violacoes) },
  ];
  const caracteres = e.comando.sistemaFixo.length + e.comando.sistemaVariavel.length + mensagens.reduce((n, m) => n + m.content.length, 0);
  const previsto = custoMaximoUsdMicro(e.escolha.modelo, caracteres, MAX_TOKENS_SAIDA, deps.precos);
  const teto = await conferirTeto(
    deps.store,
    { ownerUserId: ctx.ownerUserId, workspaceId: ctx.workspaceId, dailyCap: e.cred.dailyCap, custoPrevistoUsdMicro: previsto, now: e.now, timeZone: ctx.profile?.timeZone },
    e.limites
  );
  if (!teto.ok) return null;
  try {
    const r = await (deps.chamar ?? chamarModelo)({
      provider: e.escolha.provider,
      modelo: e.escolha.modelo,
      apiKey: abrirChave(e.cred),
      sistemaFixo: e.comando.sistemaFixo,
      sistemaVariavel: e.comando.sistemaVariavel,
      mensagens,
      maxTokens: MAX_TOKENS_SAIDA,
      chaveCache: `wa-${ctx.session.id}-${e.agente}`,
    });
    await usar(deps, ctx, e.agente, e.escolha.provider, e.escolha.modelo, r.uso, e.runId, false);
    return r;
  } catch {
    return null;
  }
}

/**
 * Ficha do lead: regra primeiro (sem custo); o que faltar, um modelo barato
 * (o padrão do agente) com teto conferido e gasto em Gastos de IA (kind
 * "ficha"). O código só aceita campo com evidência na conversa.
 */
async function atualizarFicha(
  deps: DepsMotor,
  ctx: ConversaContexto,
  e: { regras: RegrasNegocio; defs: CampoFichaDef[]; ficha: FichaLead; config: AgenteConfig; cred: AiCredentialRecord; limites: Limites; now: Date }
): Promise<{ ficha: FichaLead; mudou: boolean }> {
  const { store } = deps;
  const local = localDaConversa(e.regras, ctx.historico, e.ficha, e.defs);
  const servico = detectarServico(e.regras, ctx.historico);
  const porRegra = preencherPorRegra(e.defs, {
    regras: e.regras,
    historico: ctx.historico,
    local,
    servico,
    nomesDoContato: { name: ctx.contact.name, pushName: ctx.contact.pushName },
    now: e.now,
  });
  let j = juntarFicha(e.ficha, porRegra, e.now);
  let mudou = j.mudou;
  const faltam = e.defs.filter((d) => !j.ficha.campos[d.chave]).map((d) => d.chave);
  if (faltam.length && deps.fichaComIa !== false) {
    const escolha = escolherModelo(e.config, { dificil: false, incerto: false }, deps.precos);
    const mensagem = mensagemFicha(e.defs, faltam, ctx.historico);
    const previsto = custoMaximoUsdMicro(escolha.modelo, SISTEMA_FICHA.length + mensagem.length, MAX_TOKENS_FICHA, deps.precos);
    const teto = await conferirTeto(
      store,
      { ownerUserId: ctx.ownerUserId, workspaceId: ctx.workspaceId, dailyCap: e.cred.dailyCap, custoPrevistoUsdMicro: previsto, now: e.now, timeZone: ctx.profile?.timeZone },
      e.limites
    );
    if (teto.ok) {
      try {
        const r = await (deps.chamar ?? chamarModelo)({
          provider: escolha.provider,
          modelo: escolha.modelo,
          apiKey: abrirChave(e.cred),
          sistemaFixo: SISTEMA_FICHA,
          sistemaVariavel: "",
          mensagens: [{ role: "user", content: mensagem }],
          maxTokens: MAX_TOKENS_FICHA,
          chaveCache: `wa-ficha-${ctx.session.id}`,
        });
        await usar(deps, ctx, e.config.agente, escolha.provider, escolha.modelo, r.uso, null, false, "ficha");
        const saida = lerSaidaFicha(r.texto);
        if (saida) {
          const nomes = [ctx.contact.name, ctx.contact.pushName].filter((n): n is string => Boolean(n));
          const j2 = juntarFicha(j.ficha, conferirExtracao(e.defs, saida, ctx.historico, e.now, nomes), e.now);
          mudou = mudou || j2.mudou;
          j = j2;
          if (saida.memoria && store.gravarMemoriaContato) await store.gravarMemoriaContato(ctx.contact.id, saida.memoria).catch(() => undefined);
        }
      } catch {
        // Sem a IA, a ficha fica com o que a regra achou.
      }
    }
  }
  if (mudou && store.salvarFicha) await store.salvarFicha(ctx.conversation.id, j.ficha).catch(() => undefined);
  return { ficha: j.ficha, mudou };
}

/** Aviso opcional pro WhatsApp do responsável. Devolve o texto pra juntar no aviso do painel. */
async function avisarResponsavel(store: AgentStore, ctx: ConversaContexto, resumo: string): Promise<string> {
  const cfg = ctx.profile?.avisarResponsavel;
  if (!cfg?.ligado || !cfg.telefone.trim() || !store.avisarResponsavel) return "";
  const nome = ctx.contact.name || ctx.contact.pushName || "um contato";
  const texto = `Lead qualificado no WhatsApp: ${nome}.\n${resumo}`.slice(0, 1500);
  try {
    const r = await store.avisarResponsavel({ sessionId: ctx.session.id, telefone: cfg.telefone, texto });
    return r.ok ? " (resumo enviado pro WhatsApp do responsável)" : ` (não deu pra mandar o resumo pro WhatsApp do responsável: ${r.motivo})`;
  } catch {
    return " (não deu pra mandar o resumo pro WhatsApp do responsável)";
  }
}

async function passarPraHumano(
  deps: DepsMotor,
  ownerUserId: string,
  conversationId: string,
  now: Date,
  registrar: (status: RunStatus, extra: Partial<AgentRunRecord>) => Promise<string>,
  motivo: string,
  output: AgentRunRecord["output"] = null
): Promise<ResultadoMotor> {
  const runId = await registrar("handoff", { blockedReason: motivo, output });
  // Pausa o agente na conversa até alguém olhar (mesmo prazo do "Assumir").
  await deps.store.definirTakeover(conversationId, new Date(now.getTime() + TAKEOVER_HORAS_PADRAO * 3600 * 1000));
  await deps.store.cancelarEnvios(conversationId);
  await deps.notificar?.({ ownerUserId, conversationId, tipo: "handoff", mensagem: `Uma conversa precisa de você: ${motivo}` });
  return { acao: "humano", motivo, runId };
}

/* ---------- Aprovação do rascunho ---------- */

export type FalhaAprovacao = "nao_encontrado" | "nao_pendente" | "janela_fechada" | "vazio" | "falha_envio";

export async function aprovarRascunho(
  deps: Pick<DepsMotor, "store" | "rng">,
  input: { runId: string; ownerUserId: string; aprovadoPor: string; bolhasEditadas?: string[]; now?: Date }
): Promise<{ ok: true; jobId: string; bolhas: string[] } | { ok: false; erro: FalhaAprovacao; mensagem: string }> {
  const now = input.now ?? new Date();
  const run = await deps.store.buscarRun(input.runId);
  if (!run || run.ownerUserId !== input.ownerUserId) return { ok: false, erro: "nao_encontrado", mensagem: "Rascunho não encontrado." };
  if (run.status !== "draft") return { ok: false, erro: "nao_pendente", mensagem: "Esse rascunho já foi tratado." };
  const ctx = await deps.store.carregarContexto(run.conversationId);
  const ultima = ctx ? ultimaDoContato(ctx.historico) : null;
  const bolhas = quebrarEmBolhas(input.bolhasEditadas ?? run.output?.bolhas ?? []);
  if (!bolhas.length) return { ok: false, erro: "vazio", mensagem: "O rascunho está vazio." };
  // Você mesmo aprovou: espera curta, mas ainda com "digitando...".
  const envios = planejarRitmo(bolhas, deps.rng, { esperaInicialMinMs: 2_000, esperaInicialMaxMs: 6_000 });
  if (!janelaAberta(ultima?.sentAt ?? null, now, duracaoTotalMs(envios))) {
    return { ok: false, erro: "janela_fechada", mensagem: "Passaram 24h da última mensagem do contato. Agora só ele pode puxar a conversa." };
  }
  const output = { bolhas, motivo: run.output?.motivo ?? null };
  if (deps.store.marcarAprovado) {
    // Atômico: só o primeiro clique passa.
    if (!(await deps.store.marcarAprovado(run.id!, input.aprovadoPor, output))) {
      return { ok: false, erro: "nao_pendente", mensagem: "Esse rascunho já foi tratado." };
    }
  } else {
    await deps.store.atualizarRun(run.id!, { status: "approved", approvedBy: input.aprovadoPor, output });
  }
  // "scheduled" antes de entrar na fila: o envio confere podeEnviar, que só aceita run agendado.
  await deps.store.atualizarRun(run.id!, { status: "scheduled" });
  try {
    const jobId = await deps.store.agendarEnvio({ runId: run.id!, conversationId: run.conversationId, sessionId: run.sessionId, envios });
    // Edição antes de enviar = exemplo de como a empresa responde (sem dado pessoal).
    if (input.bolhasEditadas && ctx && deps.store.registrarExemplo) {
      const ex = exemploDaEdicao({
        sessionId: run.sessionId,
        agente: run.agente,
        runId: run.id!,
        historico: ctx.historico,
        original: run.output?.bolhas ?? [],
        enviado: bolhas,
        nomesDoContato: [ctx.contact.name, ctx.contact.pushName].filter((n): n is string => Boolean(n)),
      });
      if (ex) await deps.store.registrarExemplo(ex).catch(() => undefined);
    }
    return { ok: true, jobId, bolhas };
  } catch {
    await deps.store.atualizarRun(run.id!, { status: "draft", approvedBy: null });
    return { ok: false, erro: "falha_envio", mensagem: "Não deu pra colocar o envio na fila agora. Tente de novo." };
  }
}

export async function rejeitarRascunho(store: AgentStore, input: { runId: string; ownerUserId: string }): Promise<boolean> {
  const run = await store.buscarRun(input.runId);
  if (!run || run.ownerUserId !== input.ownerUserId || run.status !== "draft") return false;
  await store.atualizarRun(run.id!, { status: "rejected", blockedReason: "você recusou o rascunho" });
  // Rascunho descartado entra no relatório "O que o agente aprendeu".
  if (store.registrarCaso) {
    const ctx = await store.carregarContexto(run.conversationId).catch(() => null);
    const nomes = ctx ? [ctx.contact.name, ctx.contact.pushName].filter((n): n is string => Boolean(n)) : [];
    await caso(store, {
      sessionId: run.sessionId,
      tipo: "descartado",
      regra: run.blockedReason?.startsWith("Regra do negócio") ? "rascunho_com_regra" : null,
      pergunta: ctx ? limparExemplo(perguntaAntes(ctx.historico, ctx.historico.length), nomes, MAX_PERGUNTA) || null : null,
      resposta: limparExemplo((run.output?.bolhas ?? []).join("\n"), nomes, MAX_RESPOSTA) || null,
      conversaHash: hashConversa(run.conversationId),
      origemId: `descartado:${run.id}`,
    });
  }
  return true;
}

/**
 * A equipe respondeu no lugar do agente (inbox ou celular, o que também pausa
 * o agente): o par cliente -> resposta vira exemplo do negócio. Só quando o
 * número tem agente ligado e a resposta veio logo depois de uma mensagem do cliente.
 */
export async function aprenderRespostaHumana(
  store: AgentStore,
  input: { conversationId: string; mensagemId?: string; texto?: string }
): Promise<boolean> {
  if (!store.registrarExemplo) return false;
  try {
    const ctx = await store.carregarContexto(input.conversationId);
    if (!ctx || ctx.contact.isGroup) return false;
    if (ctx.session.agentMode !== "DRAFT" && ctx.session.agentMode !== "AUTO") return false;
    const configs = await store.configAgentes(ctx.ownerUserId, ctx.session.id);
    if (!configs.some((c) => c.ativo)) return false;
    const ex = exemploDaRespostaHumana({
      sessionId: ctx.session.id,
      historico: ctx.historico,
      mensagemId: input.mensagemId,
      texto: input.texto,
      nomesDoContato: [ctx.contact.name, ctx.contact.pushName].filter((n): n is string => Boolean(n)),
      agente: ctx.conversation.lead?.estagio === "cliente" ? "suporte" : null,
    });
    if (!ex) return false;
    await store.registrarExemplo(ex);
    return true;
  } catch {
    return false;
  }
}

/**
 * O conector chama antes de cada bolha. Se você assumiu, se a janela fechou ou
 * se o agente foi desligado depois do agendamento, nada sai.
 */
export async function podeEnviar(
  store: AgentStore,
  input: { runId: string; now?: Date; duracaoRestanteMs?: number }
): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const now = input.now ?? new Date();
  const run = await store.buscarRun(input.runId);
  if (!run || run.status !== "scheduled") return { ok: false, motivo: "envio cancelado" };
  const ctx = await store.carregarContexto(run.conversationId);
  if (!ctx) return { ok: false, motivo: "conversa não encontrada" };
  const ultima = ultimaDoContato(ctx.historico);
  if (!janelaAberta(ultima?.sentAt ?? null, now, input.duracaoRestanteMs ?? 0)) return { ok: false, motivo: "janela de 24h fechada" };
  // Rascunho que você aprovou: a decisão foi sua. Clicar "Assumir" depois cancela ele também (vira rejected).
  if (run.approvedBy) return { ok: true };
  if (takeoverAtivo(ctx.conversation.humanTakeoverUntil, now)) return { ok: false, motivo: "você assumiu a conversa" };
  if (resolverModo(ctx, now).modo !== "AUTO") return { ok: false, motivo: "envio automático desligado" };
  return { ok: true };
}
