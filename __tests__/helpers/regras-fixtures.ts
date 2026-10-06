/**
 * Regras FICTÍCIAS pros testes das regras duras, da ficha e do estágio do
 * lead. Nenhum dado de cliente de verdade: empresa, pessoas e telefones
 * inventados (cidades são só nomes públicos de cidades).
 *
 * - obraBoa(): empresa de reformas que atende Paulínia/SP e Campinas/SP, não
 *   atende Hortolândia, manda o bairro Campo Grande (Campinas) pra análise,
 *   obra grande fora da região vai pra análise, não faz pequeno reparo
 *   isolado, mas faz pedras (granito, mármore) separado.
 * - salao(): salão que atende só uma cidade (Itu/SP).
 * - lojaOnline(): loja que atende o Brasil todo (sem cidade nenhuma).
 */
import { vi } from "vitest";
import { lerRegras, type RegrasNegocio } from "@/lib/whatsapp/regras/esquema";
import { SISTEMA_FICHA } from "@/lib/whatsapp/regras/ficha";
import type { PedidoModelo } from "@/lib/whatsapp/agentes/provedores";
import type { ConversaContexto, WaMessageLite } from "@/lib/whatsapp/agentes/types";

export function obraBoa(): RegrasNegocio {
  return lerRegras({
    cidadesAtendidas: [
      { cidade: "Paulínia", uf: "SP" },
      { cidade: "Campinas", uf: "SP" },
    ],
    cidadesNaoAtendidas: [{ cidade: "Hortolândia", uf: "SP" }],
    regioesCuidado: [{ nome: "Campo Grande", cidade: "Campinas", uf: "SP", regra: "casa ou apartamento de médio porte vai pra análise, sem dizer que não atende" }],
    excecoesLocal: [{ descricao: "Obra grande fora da região", palavras: ["obra grande", "predio", "condominio", "galpao"] }],
    servicosAceitos: ["Reforma completa de casa, apartamento e comércio", "Construção de casa", "Pedras (granito, mármore) separado"],
    servicosRecusados: [{ descricao: "Pequeno reparo isolado", palavras: ["trocar torneira", "trocar uma torneira", "trocar tomada", "vazamento", "pequeno reparo", "conserto"] }],
    excecoesServico: [{ descricao: "Mármores, granitos e outras pedras", palavras: ["granito", "marmore", "bancada", "pedra"] }],
    infoMinima: [
      { campo: "Nome", pergunta: "Qual o seu nome?", palavras: [] },
      { campo: "Local da obra", pergunta: "Em qual cidade vai ser a obra?", palavras: [] },
      { campo: "Tipo de imóvel", pergunta: "É casa, apartamento ou comércio?", palavras: [] },
      { campo: "Situação das chaves", pergunta: "Você já pegou as chaves?", palavras: ["chave", "chaves"] },
      { campo: "Possui projeto", pergunta: "Você já tem projeto?", palavras: ["projeto", "planta"] },
    ],
    horario: "Segunda a sexta, das 9h às 17h30",
    nuncaPrometer: ["preço", "prazo", "garantia", "visita"],
    mensagemForaDaArea: "Responda com cuidado que a disponibilidade pra esse local precisa ser analisada antes de seguir.",
    mensagemServicoRecusado: "Diga com educação que a empresa faz reformas completas e não faz pequenos serviços isolados.",
    mensagensAprovadas: [{ quando: "Encaminhar", texto: "Perfeito! Vou passar pra equipe seguir com você." }],
    casosTeste: [
      { situacao: "Apartamento em Paulínia, já com chaves, quer reforma completa e tem projeto.", decisao: "Qualificar.", motivo: "Região e serviço atendidos.", esperado: ["qualificar"] },
      { situacao: "Casa em Campinas, quer reforma completa.", decisao: "Qualificar.", motivo: "Região e serviço atendidos.", esperado: ["qualificar"] },
      { situacao: "Obra fora da região padrão.", decisao: "Se for grande, análise; se não, responder com cuidado.", motivo: "Exceções.", esperado: ["analisar", "fora_da_area"] },
      { situacao: "Quer só trocar uma torneira.", decisao: "Dizer com educação que não faz.", motivo: "Serviço não atendido.", esperado: ["servico_recusado"] },
      { situacao: "Quer só uma bancada de granito.", decisao: "Seguir o atendimento.", motivo: "Pedras são exceção.", esperado: ["continuar", "qualificar"] },
      { situacao: "Casa de médio porte no Campo Grande, em Campinas.", decisao: "Passar pra análise.", motivo: "Região com cuidado.", esperado: ["analisar"] },
    ],
    resumoEquipe: ["Nome", "Cidade da obra", "Tipo de imóvel", "Situação das chaves", "Possui projeto", "Fotos enviadas"],
    responsavel: { nome: "Carla Teste", telefone: "(19) 90000-3333" },
  });
}

/** Salão que atende só Itu/SP. Qualifica com nome, serviço e dia preferido. */
export function salao(): RegrasNegocio {
  return lerRegras({
    cidadesAtendidas: [{ cidade: "Itu", uf: "SP" }],
    servicosAceitos: ["Corte", "Escova", "Coloração"],
    servicosRecusados: [{ descricao: "Depilação", palavras: ["depilacao", "depilar"] }],
    infoMinima: [
      { campo: "Nome", pergunta: "Qual o seu nome?", palavras: [] },
      { campo: "Serviço desejado", pergunta: "Qual serviço você quer fazer?", palavras: ["corte", "escova", "coloracao"] },
      { campo: "Dia preferido", pergunta: "Qual dia fica melhor pra você?", palavras: ["segunda", "terca", "quarta", "quinta", "sexta", "sabado", "dia"] },
    ],
  });
}

/** Loja online que vende pro Brasil todo: sem cidade nenhuma nas regras. */
export function lojaOnline(): RegrasNegocio {
  return lerRegras({
    servicosAceitos: ["Venda de capinhas de celular"],
    servicosRecusados: [{ descricao: "Conserto de celular", palavras: ["conserto", "consertar", "tela quebrada"] }],
    infoMinima: [
      { campo: "Modelo do celular", pergunta: "Qual o modelo do seu celular?", palavras: ["iphone", "samsung", "motorola", "xiaomi", "modelo"] },
      { campo: "CEP de entrega", pergunta: "Qual o CEP pra entrega?", palavras: ["cep"] },
    ],
  });
}

export const AGORA = new Date("2026-10-06T15:00:00Z");

let seq = 0;
export function cliente(body: string, minutosAtras = 1, extra: Partial<WaMessageLite> = {}): WaMessageLite {
  return { id: `c${++seq}`, fromMe: false, sentBy: "CONTACT", type: "text", body, sentAt: new Date(AGORA.getTime() - minutosAtras * 60_000), ...extra };
}
export function nos(body: string, minutosAtras = 1): WaMessageLite {
  return { id: `n${++seq}`, fromMe: true, sentBy: "AGENT", type: "text", body, sentAt: new Date(AGORA.getTime() - minutosAtras * 60_000) };
}

export function contextoComRegras(historico: WaMessageLite[], regras: RegrasNegocio | null, over: Partial<{ numero: "DRAFT" | "AUTO"; nome: string | null; pushName: string | null }> = {}): ConversaContexto {
  return {
    ownerUserId: "u1",
    workspaceId: "w1",
    session: { id: "s1", provider: "OPENWA", agentMode: over.numero ?? "AUTO" },
    conversation: { id: "conv1", agentMode: "INHERIT", humanTakeoverUntil: null, labelModes: [] },
    contact: { id: "ct1", isGroup: false, name: over.nome ?? null, pushName: over.pushName === undefined ? null : over.pushName },
    profile: {
      baseCommand: "Obra Boa Teste: reformas e construção.",
      styleSummary: null,
      styleExamples: null,
      quietHours: null,
      maxAutoPerDay: 50,
      fatosPermitidos: [],
      regras,
    },
    historico,
  };
}

/** Resposta do agente em JSON (o que o modelo falso devolve). */
export function respostaAgente(o: {
  bolhas: string[];
  passar?: boolean;
  qualificado?: boolean;
  motivo?: string;
  local?: { cidade?: string; uf?: string; bairro?: string };
  servico?: string;
  excecao?: string;
  coletado?: Record<string, string>;
}): string {
  return JSON.stringify({
    bolhas: o.bolhas,
    passar_pra_humano: o.passar ?? false,
    qualificado: o.qualificado ?? false,
    motivo: o.motivo ?? "",
    resumo_equipe: "",
    local_obra: o.local ?? { cidade: "", uf: "", bairro: "" },
    servico: o.servico ?? "desconhecido",
    excecao: o.excecao ?? "",
    coletado: o.coletado ?? {},
  });
}

/**
 * Modelo falso: a chamada da ficha (SISTEMA_FICHA) responde `ficha`; as do
 * agente respondem a fila `agente` na ordem (a última se repete).
 */
export function modeloFalso(agente: string[], ficha = '{"campos": {}, "memoria": null}') {
  const filaAgente = [...agente];
  const chamadas: PedidoModelo[] = [];
  const chamar = vi.fn(async (p: PedidoModelo) => {
    chamadas.push(p);
    const texto = p.sistemaFixo === SISTEMA_FICHA ? ficha : (filaAgente.length > 1 ? filaAgente.shift()! : filaAgente[0]);
    return { texto, uso: { tokensIn: 100, tokensOut: 20, cacheRead: 0, cacheWrite: 0 } };
  });
  return { chamar, chamadas, doAgente: () => chamadas.filter((c) => c.sistemaFixo !== SISTEMA_FICHA), daFicha: () => chamadas.filter((c) => c.sistemaFixo === SISTEMA_FICHA) };
}
