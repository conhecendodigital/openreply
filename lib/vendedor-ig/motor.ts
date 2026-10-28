/**
 * Motor do vendedor automático do Instagram. Sem banco, sem rede: tudo entra por `deps`,
 * então cada regra é testável. Fluxo por conversa:
 *
 *   regras (janela, takeover, parar, só-agradeceu, rascunho pendente, limites, ritmo)
 *   -> reserva da DM (uma decisão por DM, mesmo com duas rodadas ao mesmo tempo)
 *   -> robô? (resposta fixa e honesta, e chama o dono) | assunto sensível? (fica pro dono)
 *   -> teto de gasto de IA -> cartão da pessoa -> modelo -> travas de conteúdo
 *   -> recheca a conversa (takeover, DM nova) -> ENVIA em partes | vira RASCUNHO
 *
 * Qualquer dúvida, falha ou trava de conteúdo = RASCUNHO. A IA falhar nunca envia nada.
 */
import { shapeVendedorText } from "@/lib/drafts/parts";
import type { StoredMessage } from "@/lib/inbox/context";
import { afirmacoesInventadas, descreverInventadas } from "@/lib/whatsapp/agentes/guardas";
import { ErroModelo } from "@/lib/whatsapp/agentes/provedores";
import type { VendedorConfig } from "./config";
import { assuntoSensivel, decidir, perguntouSeERobo, RESPOSTA_SOU_IA, type Contagens, type EstadoContato } from "./regras";
import { fontesPermitidas, lerSaidaVendedor, MAX_TOKENS_VENDEDOR, sistemaFixo, sistemaVariavel, violacoesDeVoz } from "./prompt";

/** Abaixo disso o vendedor não envia sozinho: vira rascunho. */
export const CONFIANCA_MINIMA = 0.6;

export type Outcome = "sent" | "draft" | "skipped" | "stopped" | "error";

export type Resultado = { outcome: Outcome | "esperar"; motivo: string; texto?: string; partes?: number };

export interface RespostaIa {
  texto: string;
  modelo: string;
  custoMicro: number;
}

export interface DepsVendedor {
  agora(): Date;
  config: VendedorConfig;
  /** Estado atual do contato (relido antes de enviar). */
  contato(): Promise<EstadoContato>;
  mensagens(): Promise<StoredMessage[]>;
  contagens(): Promise<Contagens>;
  temRascunhoPendente(): Promise<boolean>;
  paradoAntes(): Promise<boolean>;
  /** Reserva a DM (uma decisão por DM). null = outra rodada já pegou. */
  reservar(inboundMid: string): Promise<string | null>;
  finalizar(logId: string, dados: { outcome: Outcome; reason: string; text?: string; parts?: number; mids?: string[]; draftId?: string | null; model?: string | null; costMicroUsd?: number }): Promise<void>;
  /** Pergunta a IA. Joga ErroModelo se falhar. */
  perguntarIa(input: { sistemaFixo: string; sistemaVariavel: string; mensagem: string; dificil: boolean }): Promise<RespostaIa>;
  /** false = teto diário de gasto de IA atingido. */
  podeGastar(): Promise<boolean>;
  cartao(): Promise<string>;
  nomeDaPessoa(): string | null;
  /** Envia as partes em ordem (ritmo humano dentro). */
  enviar(partes: string[], logId: string): Promise<{ mids: string[]; falha: { indice: number; mensagem: string; janelaFechada: boolean } | null }>;
  criarRascunho(texto: string, motivo: string): Promise<{ ok: true; id: string } | { ok: false; erro: string }>;
  registrarParada(inboundMid: string, texto: string | null): Promise<void>;
  chamarDono(motivo: string): Promise<void>;
}

function ultimaDaPessoa(msgs: StoredMessage[]): StoredMessage | null {
  for (let i = msgs.length - 1; i >= 0; i--) if (!msgs[i].fromMe) return msgs[i];
  return null;
}

export async function processarConversa(deps: DepsVendedor): Promise<Resultado> {
  const now = deps.agora();
  const { config } = deps;
  const msgs = await deps.mensagens();
  const lite = msgs.map((m) => ({ mid: m.mid, fromMe: m.fromMe, text: m.kind === "text" || m.kind === "story" ? m.text : m.fromMe ? m.text : null, storyReply: m.storyReply, sentAt: m.sentAt }));
  const ultima = ultimaDaPessoa(msgs);
  if (!ultima || msgs[msgs.length - 1].fromMe) return { outcome: "esperar", motivo: "a última mensagem é nossa" };

  const decisao = decidir({
    now,
    config,
    contato: await deps.contato(),
    mensagens: lite,
    temRascunhoPendente: await deps.temRascunhoPendente(),
    paradoAntes: await deps.paradoAntes(),
    contagens: await deps.contagens(),
  });
  if (decisao.acao === "esperar") return { outcome: "esperar", motivo: decisao.motivo };

  // A partir daqui a DM vira uma decisão registrada (uma por DM).
  const logId = await deps.reservar(ultima.mid);
  if (!logId) return { outcome: "esperar", motivo: "essa DM já foi tratada" };
  const fim = async (outcome: Outcome, reason: string, extra: Partial<Parameters<DepsVendedor["finalizar"]>[1]> = {}): Promise<Resultado> => {
    await deps.finalizar(logId, { outcome, reason, ...extra });
    return { outcome, motivo: reason, texto: extra.text, partes: extra.parts };
  };

  if (decisao.acao === "parar") {
    await deps.registrarParada(ultima.mid, ultima.text);
    return fim("stopped", decisao.motivo);
  }
  if (decisao.acao === "pular") return fim("skipped", decisao.motivo);

  const textoDela = ultima.text ?? "";
  if (assuntoSensivel(textoDela)) return fim("skipped", "assunto sensível ou que só você resolve: ficou pra você");

  // Pergunta sincera se é robô: resposta fixa e honesta, e chama o dono.
  if (perguntouSeERobo(textoDela)) {
    const env = await deps.enviar(RESPOSTA_SOU_IA.split(/\n{2,}/), logId);
    if (env.falha) return fim("error", `não enviou a resposta sobre ser IA: ${env.falha.mensagem}`, { mids: env.mids });
    await deps.chamarDono("a pessoa perguntou se fala com robô ou pessoa");
    return fim("sent", "a pessoa perguntou se é robô: disse que é IA e chamou você", {
      text: RESPOSTA_SOU_IA,
      parts: env.mids.length,
      mids: env.mids,
    });
  }

  if (!(await deps.podeGastar())) return fim("skipped", "teto diário de gasto com IA atingido: ficou pra você");

  // Modelo.
  let resposta: RespostaIa;
  try {
    const cartao = await deps.cartao();
    resposta = await deps.perguntarIa({
      sistemaFixo: sistemaFixo(config),
      sistemaVariavel: sistemaVariavel(cartao, msgs, deps.nomeDaPessoa()),
      mensagem: textoDela || ultima.preview,
      dificil: false,
    });
  } catch (e) {
    const motivo = e instanceof ErroModelo ? e.message : "a IA falhou";
    return fim("error", `${motivo} Nada foi enviado.`);
  }
  const custo = resposta.custoMicro;
  const comIa = { model: resposta.modelo, costMicroUsd: custo };
  const saida = lerSaidaVendedor(resposta.texto);
  if (!saida || saida.partes.length === 0) return fim("error", "a IA devolveu uma resposta ilegível. Nada foi enviado.", comIa);

  const texto = shapeVendedorText(saida.partes.join("\n\n"));
  const partes = texto.split(/\n{2,}/).filter(Boolean);

  // Travas: qualquer uma vira RASCUNHO com o aviso.
  const avisos: string[] = [];
  if (saida.passarProDono) avisos.push(saida.motivo ? `a IA pediu o dono: ${saida.motivo}` : "a IA pediu o dono");
  if (saida.confianca < CONFIANCA_MINIMA) avisos.push(`confiança baixa (${saida.confianca.toFixed(2)})`);
  const inventadas = afirmacoesInventadas(texto, fontesPermitidas(config));
  if (inventadas.length) avisos.push(descreverInventadas(inventadas));
  for (const v of violacoesDeVoz(texto)) avisos.push(v);

  if (avisos.length > 0) {
    const r = await deps.criarRascunho(texto, `Vendedor automático em dúvida: ${avisos.join("; ")}`.slice(0, 900));
    if (!r.ok) return fim("error", `não deu pra criar o rascunho: ${r.erro}`, { ...comIa, text: texto });
    return fim("draft", avisos.join("; ").slice(0, 400), { ...comIa, text: texto, parts: partes.length, draftId: r.id });
  }

  // Recheca logo antes de enviar: takeover novo, janela, DM nova da pessoa (o que escrevi já ficou velho).
  const msgs2 = await deps.mensagens();
  const nova = ultimaDaPessoa(msgs2);
  if (!nova || nova.mid !== ultima.mid || msgs2[msgs2.length - 1].fromMe) {
    return fim("skipped", "a pessoa mandou outra mensagem (ou alguém respondeu) enquanto eu escrevia: nada enviado", comIa);
  }
  const estado2 = await deps.contato();
  const redecisao = decidir({
    now: deps.agora(),
    config: { ...config, replyDelayMinSec: 0, replyDelayMaxSec: 0, minGapSeconds: 0, quietStart: null, quietEnd: null },
    contato: estado2,
    mensagens: msgs2.map((m) => ({ mid: m.mid, fromMe: m.fromMe, text: m.text, storyReply: m.storyReply, sentAt: m.sentAt })),
    temRascunhoPendente: false,
    paradoAntes: await deps.paradoAntes(),
    contagens: { hora: 0, dia: 0, pessoaDia: 0, ultimoEnvioEm: null },
  });
  if (redecisao.acao !== "responder") return fim("skipped", `na hora de enviar: ${redecisao.motivo}`, { ...comIa, text: texto });

  const env = await deps.enviar(partes, logId);
  if (env.falha) {
    const msg = env.falha.janelaFechada ? "a janela de 24 h fechou na hora de enviar" : env.falha.mensagem;
    return fim("error", `falha ao enviar (${env.falha.indice} de ${partes.length} partes já saíram): ${msg}`.slice(0, 400), {
      ...comIa,
      text: texto,
      parts: env.mids.length,
      mids: env.mids,
    });
  }
  return fim("sent", "respondeu sozinho", { ...comIa, text: texto, parts: partes.length, mids: env.mids });
}
