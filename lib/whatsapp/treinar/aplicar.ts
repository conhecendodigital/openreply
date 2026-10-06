/**
 * Coloca o rascunho do documento nos campos da tela Agentes (no navegador).
 * Puro, sem rede: a tela chama, e os testes conferem que o modo do número e o
 * liga/desliga de cada agente ficam como estavam (o rascunho nunca liga nada).
 * Campo que o documento não trouxe fica com o valor que já estava na tela.
 */
import type { RascunhoTreino } from "./esquema";

export interface VistaAgentesTreino {
  numberMode: "OFF" | "DRAFT";
  profile: {
    baseCommand: string;
    quietStart: string;
    quietEnd: string;
    maxAutoPerDay: number;
    delayMinSeconds: number;
    delayMaxSeconds: number;
    facts: string[];
  };
  agents: Array<{ agente: "qualificacao" | "atendimento" | "suporte"; ativo: boolean; instrucoes: string }>;
}

export function aplicarRascunho<V extends VistaAgentesTreino>(view: V, r: RascunhoTreino): V {
  const p = r.profile;
  return {
    ...view,
    numberMode: view.numberMode,
    profile: {
      ...view.profile,
      baseCommand: p.baseCommand || view.profile.baseCommand,
      facts: p.facts.length ? p.facts : view.profile.facts,
      quietStart: p.quietStart && p.quietEnd ? p.quietStart : view.profile.quietStart,
      quietEnd: p.quietStart && p.quietEnd ? p.quietEnd : view.profile.quietEnd,
      delayMinSeconds: p.delayMinSeconds ?? view.profile.delayMinSeconds,
      delayMaxSeconds: p.delayMaxSeconds ?? view.profile.delayMaxSeconds,
      maxAutoPerDay: p.maxAutoPerDay ?? view.profile.maxAutoPerDay,
    },
    agents: view.agents.map((a) => ({ ...a, ativo: a.ativo, instrucoes: r.agents[a.agente] || a.instrucoes })),
  };
}
