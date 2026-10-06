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

  // Tela Agentes: regras do negócio
  "Business rules": "Regras do negócio",
  "The system checks these rules by itself in every answer, before sending or marking a lead as qualified. They only change when you click Save or accept a suggestion.":
    "O sistema confere essas regras sozinho em cada resposta, antes de enviar ou de marcar um lead como qualificado. Elas só mudam quando você clica em Salvar ou aceita uma sugestão.",
  "Example: {x}": "Exemplo: {x}",
  "Cities served (one per line, City/UF)": "Cidades atendidas (uma por linha, Cidade/UF)",
  "Cities not served (one per line)": "Cidades não atendidas (uma por linha)",
  "Neighborhoods or regions that go for review": "Bairros ou regiões que vão pra análise",
  "Format: name, City/UF | what to do": "Formato: nome, Cidade/UF | o que fazer",
  "Place exceptions that go for review": "Exceções de local que vão pra análise",
  "Format: description | words the customer would use": "Formato: descrição | palavras que o cliente usaria",
  "Services accepted (one per line)": "Serviços aceitos (um por linha)",
  "Services the company does not do": "Serviços que a empresa não faz",
  "Service exceptions (accepted anyway)": "Exceções de serviço (atendidas mesmo assim)",
  "Minimum information to qualify": "Informações mínimas pra qualificar",
  "Format: information | words that show it. Qualified only with all of them.": "Formato: informação | palavras que mostram ela. Qualificado só com todas.",
  "What goes in the summary for the team (one per line)": "O que vai no resumo pra equipe (um por linha)",
  "Never promise (one per line)": "Nunca prometer (um por linha)",
  "Business hours": "Horário de atendimento",
  "How to answer when the place is outside the area": "Como responder quando o local está fora da área",
  "How to answer when the company does not do the service": "Como responder quando a empresa não faz o serviço",
  "Test cases and the expected decision": "Casos de teste e a decisão esperada",
  "No test cases yet. They come from the decision examples of the document.": "Ainda não tem casos de teste. Eles vêm dos exemplos de decisão do documento.",
  "Campo Grande, Campinas/SP | send for review": "Campo Grande, Campinas/SP | vai pra análise",
  "Big job outside the region | big job, building": "Obra grande fora da região | obra grande, prédio",
  "Small isolated repair | change faucet, leak": "Pequeno reparo isolado | trocar torneira, vazamento",
  "Stones | granite, marble": "Pedras | granito, mármore",
  "Keys situation | keys": "Situação das chaves | chaves",
  price: "preço",

  // Decisões
  Qualify: "Qualificar",
  "Send for review": "Passar pra análise",
  "Outside the area (careful answer)": "Fora da área (resposta com cuidado)",
  "Service the company does not do": "Serviço que a empresa não faz",
  "Hand over to a person": "Passar pra uma pessoa",
  "Keep asking": "Seguir perguntando",
  "Broke a business rule": "Quebrou uma regra do negócio",
  "Stopped by the daily AI cap": "Parou no teto diário de IA",
  "AI error": "Erro da IA",

  // Regras quebradas
  "Qualified without knowing where the service is": "Qualificou sem saber onde é o serviço",
  "Qualified outside the area": "Qualificou fora da área",
  "Qualified a service the company does not do": "Qualificou um serviço que a empresa não faz",
  "Qualified without the minimum information": "Qualificou sem as informações mínimas",
  "Said it serves a place outside the area": "Disse que atende um local fora da área",
  "Confirmed service before knowing the place": "Confirmou atendimento antes de saber o local",
  "Refused in a dry way": "Recusou de forma seca",
  "Said it does a service the company does not do": "Disse que faz um serviço que a empresa não faz",
  "Did not ask where the service is": "Não perguntou onde é o serviço",
  "Asked again something the customer already said": "Perguntou de novo o que o cliente já disse",
  "Promised something the company never promises": "Prometeu algo que a empresa nunca promete",
  "Draft with a rule warning": "Rascunho com aviso de regra",
  "Other rule": "Outra regra",

  // Estágios e aviso ao responsável
  "Lead stages": "Estágios do lead",
  "The agent moves each lead by itself, following the rules above. Leave the name empty to use the standard one.":
    "O agente muda cada lead de estágio sozinho, seguindo as regras acima. Deixe o nome vazio pra usar o padrão.",
  "Name of the stage {stage}": "Nome do estágio {stage}",
  "Send the qualified lead summary to the person in charge on WhatsApp": "Mandar o resumo do lead qualificado pro WhatsApp do responsável",
  "The summary goes out from this same number, and only if the person in charge sent a message to this number in the last 24 hours. Off by default.":
    "O resumo sai por esse mesmo número, e só se o responsável mandou mensagem pra esse número nas últimas 24 horas. Vem desligado.",
  "WhatsApp of the person in charge, with area code": "WhatsApp do responsável, com DDD",

  // Ritmo humano
  "Wait for the customer to finish writing (seconds)": "Esperar o cliente terminar de escrever (segundos)",
  "Messages in a row (audio too) become one answer only. From 3 to 30 seconds.": "Mensagens seguidas (áudio também) viram uma resposta só. De 3 a 30 segundos.",

  // O que o agente aprendeu
  "What the agent learned": "O que o agente aprendeu",
  "When you edit a draft or answer in place of the agent, the answer becomes an example of how your company talks. Rules never change by themselves: only with your click.":
    "Quando você edita um rascunho ou responde no lugar do agente, a resposta vira exemplo de como a sua empresa fala. Regra nunca muda sozinha: só com o seu clique.",
  "Generate suggestions with AI": "Gerar sugestões com IA",
  "Generating suggestions with AI has a cost, shown in AI spending.": "Gerar sugestões com IA tem custo, que aparece em Gastos de IA.",
  "Suggestion applied. The rules or instructions were updated.": "Sugestão aplicada. As regras ou instruções foram atualizadas.",
  "Suggestion accepted.": "Sugestão aceita.",
  "{n} new suggestions.": "{n} sugestões novas.",
  "The AI found no clear pattern this time.": "A IA não achou um padrão claro dessa vez.",
  "Suggestions to change the rules": "Sugestões de mudança nas regras",
  "Suggested by the AI": "Sugerida pela IA",
  "Counted from the conversations": "Contada a partir das conversas",
  Reject: "Recusar",
  "Errors blocked by a rule (last 30 days)": "Erros bloqueados por regra (últimos 30 dias)",
  "{n} were fixed by the automatic correction and did not go out wrong.": "{n} foram resolvidos pela correção automática e não saíram errados.",
  "See the latest": "Ver os últimos",
  fixed: "corrigida",
  "not fixed": "não corrigida",
  "became a draft": "virou rascunho",
  "Discarded drafts": "Rascunhos descartados",
  "People from outside the area": "Pessoas de fora da área",
  "Learned examples": "Exemplos aprendidos",
  "Without phone, email, document or the contact name. The most similar ones go into the agent Comando as examples.":
    "Sem telefone, e-mail, documento nem o nome do contato. Os mais parecidos com a conversa entram no Comando do agente como exemplo.",
  "Your answer after taking over": "Sua resposta depois de assumir",
  "Draft you edited": "Rascunho que você editou",
  "Customer:": "Cliente:",
  "Company:": "Empresa:",

  // Testar o agente
  "Test the agent": "Testar o agente",
  "The AI plays the customer of each test case and the Qualification agent answers with the saved rules. Nothing is sent to anyone.":
    "A IA faz o papel do cliente de cada caso de teste e o agente de Qualificação responde com as regras salvas. Nada é enviado pra ninguém.",
  "Testing…": "Testando…",
  "There are no test cases yet. Train with a document that has decision examples.": "Ainda não tem casos de teste. Treine com um documento que tenha exemplos de decisão.",
  "You have changes not saved. The test uses the saved rules, so click Save first.": "Você tem mudanças sem salvar. O teste usa as regras salvas, então clique em Salvar antes.",
  "The cost shows in AI spending as Agent test.": "O custo aparece em Gastos de IA como Teste do agente.",
  "This can take up to 2 minutes. Keep this page open.": "Isso pode levar até 2 minutos. Deixe esta página aberta.",
  "{a} of {b} passed": "{a} de {b} passaram",
  "The daily AI spending cap stopped the test in the middle.": "O teto diário de gasto com IA parou o teste no meio.",
  Passed: "Passou",
  "Got:": "Resultado:",
  "See the simulated conversation": "Ver a conversa simulada",
  "Agent:": "Agente:",

  // Gastos de IA
  "Lead record": "Ficha do lead",
  "Agent test": "Teste do agente",
  "Rule suggestions": "Sugestões de regra",
};
