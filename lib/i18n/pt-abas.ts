/**
 * 2026-10-07: abas horizontais (components/ui/tabs.tsx) no lugar da página
 * com tudo empilhado: WhatsApp > Agentes, Configurações, Canais e /admin.
 * Português simples, "você", sem travessão.
 */
export const ptAbas: Record<string, string> = {
  "Has a field to fix": "Tem campo pra corrigir",
  "Fix the marked field before saving.": "Corrija o campo marcado antes de salvar.",

  // WhatsApp > Agentes
  "Agent settings": "Configuração dos agentes",
  "Number and mode": "Número e modo",
  Train: "Treinar",
  Business: "Negócio",
  Rules: "Regras",
  Rhythm: "Ritmo",
  Learning: "Aprendizado",
  "Turn on at least one agent in the Agents tab, or nothing happens.": "Ligue pelo menos um agente na aba Agentes, senão nada acontece.",
  "The number is on, but every agent is off. Turn on at least one below, or nothing happens.":
    "O número está ligado, mas todos os agentes estão desligados. Ligue pelo menos um aqui embaixo, senão nada acontece.",
  "The agents you turn on in the Agents tab write the answer and it waits for you. You approve, edit or discard it in Conversations.":
    "Os agentes que você ligar na aba Agentes escrevem a resposta e ela espera por você. Você aprova, edita ou descarta em Conversas.",
  "The agents answer by themselves, with the human delay, quiet hours and daily limit of the Rhythm tab. They hand the conversation to you only when the lead is qualified or asks for a person. An answer with a price, deadline or phone that is not in your data stays as a draft.":
    "Os agentes respondem sozinhos, com o atraso humano, o horário de silêncio e o limite por dia da aba Ritmo. Eles só passam a conversa pra você quando o lead fica qualificado ou pede uma pessoa. Resposta com preço, prazo ou telefone que não está nos seus dados fica como rascunho.",
  "Send the briefing the company filled in (PDF or Word, up to 8 MB). The AI fills in the fields of every tab as a draft. Nothing is saved and no agent turns on until you check and click Save.":
    "Envie o briefing que a empresa preencheu (PDF ou Word, até 8 MB). A IA preenche os campos de todas as abas como rascunho. Nada é salvo e nenhum agente liga até você conferir e clicar em Salvar.",
  "The agent moves each lead by itself, following the Rules tab. Leave the name empty to use the standard one.":
    "O agente muda cada lead de estágio sozinho, seguindo a aba Regras. Deixe o nome vazio pra usar o padrão.",

  // Configurações, Canais e /admin
  "Settings sections": "Partes das configurações",
  "Channel sections": "Partes dos canais",
  "Admin sections": "Partes do admin",
  "AI spending tab": "Gasto de IA",
  "Pixel tab": "Pixel",
};
