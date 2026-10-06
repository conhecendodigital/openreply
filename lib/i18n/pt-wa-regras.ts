/**
 * 2026-10-06: regras duras do negócio, "O que o agente aprendeu" e "Testar o
 * agente" na tela WhatsApp > Agentes, e as mensagens das rotas
 * /api/whatsapp/agents/aprendizado e /testar. Português simples, "você", sem travessão.
 */
export const ptWaRegras: Record<string, string> = {
  // Mensagens das rotas
  "Unknown stage.": "Estágio desconhecido.",
  "Send the fields to change.": "Mande os campos que você quer mudar.",
  "Example not found.": "Exemplo não encontrado.",
  "Suggestion not found.": "Sugestão não encontrada.",
  "This suggestion was already handled.": "Essa sugestão já foi tratada.",
  "This suggestion cannot be applied. Reject it and change the rules by hand.": "Essa sugestão não pode ser aplicada. Recuse e mude as regras na mão.",
  "There is nothing to learn from yet. Come back after some conversations.": "Ainda não tem nada pra aprender. Volte depois de algumas conversas.",
  "The AI did not answer now. Try again in a minute.": "A IA não respondeu agora. Tente de novo em um minuto.",
  "There are no test cases yet. Train with a document that has decision examples, or add them in the business rules.":
    "Ainda não tem casos de teste. Treine com um documento que tenha exemplos de decisão, ou cadastre nas regras do negócio.",
  "Too many requests in a short time. Try again in a while.": "Muitos pedidos em pouco tempo. Tente de novo daqui a pouco.",
  "Too many tests in a short time. Try again in a while.": "Muitos testes em pouco tempo. Tente de novo daqui a pouco.",
  "API keys cannot test the WhatsApp agents. Do it in the Lead Engine.": "Chave de API não pode testar os agentes do WhatsApp. Faça isso no Lead Engine.",
  "API keys cannot change WhatsApp leads. Do it in the Lead Engine.": "Chave de API não pode mudar os leads do WhatsApp. Faça isso no Lead Engine.",
  "API keys cannot export WhatsApp leads. Do it in the Lead Engine.": "Chave de API não pode exportar os leads do WhatsApp. Faça isso no Lead Engine.",
};
