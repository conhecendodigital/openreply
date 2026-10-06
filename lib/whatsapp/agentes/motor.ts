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
import { duracaoTotalMs, planejarRitmo, quebrarEmBolhas, type Sorteio } from "./bolhas";
import { lerSaida, montarComando } from "./comando";
import { abrirChave } from "./credenciais";
import { descreverInventadas, afirmacoesInventadas } from "./guardas";
import { PERGUNTAS_CHECAR, perguntarJev, type JevOpcoes } from "./jev";
import { custoMaximoUsdMicro, custoUsdMicro, escolherModelo, type Preco } from "./modelos";
import { janelaAberta, resolverModo, takeoverAtivo, TAKEOVER_HORAS_PADRAO } from "./modo";
import { chamarModelo, ErroModelo, type ChamarModelo } from "./provedores";
import { autoEnviosHoje, conferirTeto, emSilencio, limitesDoAmbiente, mensagemTeto } from "./teto";
import { triar, ultimaDoContato, type DecisaoTriagem } from "./triagem";
import type { AgenteTipo, AgentRunRecord, AgentStore, BrainRetriever, IaProvider, Limites, RunStatus, Uso } from "./types";

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
  }) => Promise<void>;
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

  // 3. Contexto: cérebro + memória + tom
  const consulta = ctx.historico
    .filter((m) => !m.fromMe)
    .slice(-3)
    .map((m) => m.body ?? "")
    .join("\n");
  const [trechos, memoria] = await Promise.all([
    deps.cerebro
      .buscar({ ownerUserId: ctx.ownerUserId, sessionId: ctx.session.id, agente: config.agente, consulta, limite: 6 })
      .catch(() => []),
    store.lerMemoria(ctx.contact.id),
  ]);
  const comando = montarComando({
    agente: config.agente,
    config,
    profile: ctx.profile,
    trechos,
    memoria,
    historico: ctx.historico,
    nomesDoContato: [ctx.contact.name, ctx.contact.pushName].filter((n): n is string => Boolean(n)),
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

  const saida = lerSaida(resposta.texto);
  if (!saida) {
    const runId = await registrar("error", { blockedReason: "A IA devolveu uma resposta fora do formato." });
    return { acao: "erro", motivo: "resposta fora do formato", runId };
  }
  const bolhas = quebrarEmBolhas(saida.bolhas);
  if (saida.passarPraHumano || bolhas.length === 0) {
    // 2026-10-06 (Matheus): transfere quando o lead fica qualificado (ou pede uma
    // pessoa); o resumo pra equipe vai no motivo e no aviso.
    const motivoHumano = saida.qualificado
      ? `lead qualificado${saida.resumoEquipe ? `: ${saida.resumoEquipe}` : ""}`
      : saida.motivo || "o agente não soube responder";
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
  const alertas: string[] = [];
  const inventadas = afirmacoesInventadas(bolhas.join("\n"), comando.fontesPermitidas);
  if (inventadas.length) alertas.push(descreverInventadas(inventadas));
  const checagem = await perguntarJev({ ultima_mensagem_do_cliente: ultima.body ?? "", resposta: bolhas.join("\n") }, PERGUNTAS_CHECAR, deps.jev);
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
  bloqueado: boolean
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
    });
  } catch {
    // O relatório não pode derrubar a resposta.
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
  return true;
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
