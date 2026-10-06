/**
 * 2026-10-06: /admin > Chaves de IA e Gastos de IA, e Configurações > Meu
 * gasto de IA. Inclui as mensagens que as rotas de /api/admin/ai devolvem.
 */
export const ptIa: Record<string, string> = {
  // Seções
  "AI keys": "Chaves de IA",
  "AI spending": "Gastos de IA",
  "My AI spending": "Meu gasto de IA",
  "One key per provider, used by every user in the beta. After you save it, only the last 4 characters show up here. Every change goes to the audit log.":
    "Uma chave por provedor, usada por todos os usuários do beta. Depois de salva, aqui só aparecem os 4 últimos caracteres. Toda mudança vai pro registro de auditoria.",
  "What each call to the AI cost, per user, workspace, agent and model. Estimated with the price table above.":
    "Quanto custou cada chamada de IA, por usuário, workspace, agente e modelo. Estimativa com a tabela de preços acima.",
  "Only what your agents spent with AI. Nobody else's spending shows up here.":
    "Só o que os seus agentes gastaram com IA. O gasto de outras pessoas não aparece aqui.",

  // Chaves
  "ends in ••••{last4}": "termina em ••••{last4}",
  "No key yet": "Nenhuma chave ainda",
  "Paste the key here": "Cole a chave aqui",
  "{provider} key": "Chave {provider}",
  Test: "Testar",
  "Testing...": "Testando...",
  Replace: "Trocar",
  "Key saved.": "Chave salva.",
  "Key removed.": "Chave removida.",
  "Remove the {provider} key? The agents that use it stop until you save a new one.":
    "Remover a chave {provider}? Os agentes que usam essa chave param até você salvar outra.",
  "Provider said: {detail}": "O provedor disse: {detail}",
  "Could not load the AI keys. Check the database roles (docs/ia-chaves-e-gastos.md).":
    "Não deu pra carregar as chaves de IA. Confira os papéis do banco (docs/ia-chaves-e-gastos.md).",
  "Could not reach the server. Try again.": "Não deu pra falar com o servidor. Tente de novo.",
  "Could not test. Try again.": "Não deu pra testar. Tente de novo.",
  "Could not remove. Try again.": "Não deu pra remover. Tente de novo.",

  // Configurações de IA
  "Model of each agent": "Modelo de cada agente",
  "The everyday model answers most messages. The hard case model only comes in when the conversation is hard or the Jev is unsure.":
    "O modelo do dia a dia responde a maioria das mensagens. O modelo do caso difícil só entra quando a conversa é difícil ou o Jev fica em dúvida.",
  Qualification: "Qualificação",
  "Customer service": "Atendimento",
  Support: "Suporte",
  Brain: "Cérebro",
  Triage: "Triagem",
  "Provider of {agent}": "Provedor do agente {agent}",
  "Everyday model of {agent}": "Modelo do dia a dia do agente {agent}",
  "Hard case model of {agent}": "Modelo do caso difícil do agente {agent}",
  "Daily spending caps": "Tetos de gasto por dia",
  "When the day's spending reaches the cap, the agent stops calling the AI until midnight (Brasília time). At 80% a warning shows up here.":
    "Quando o gasto do dia chega no teto, o agente para de chamar a IA até a meia-noite (horário de Brasília). Com 80% aparece um aviso aqui.",
  "Per user (US$ per day)": "Por usuário (US$ por dia)",
  "Per workspace (US$ per day)": "Por workspace (US$ por dia)",
  "Dollar rate in R$ (optional)": "Cotação do dólar em R$ (opcional)",
  "Only dollars": "Só em dólar",
  "Price table": "Tabela de preços",
  "Dollars per 1 million tokens. Prices change: check the Anthropic, OpenAI and TypeSafe pages and edit here. Each call keeps the price of the moment it happened.":
    "Dólares por 1 milhão de tokens. Preço muda: confira nas páginas da Anthropic, da OpenAI e da TypeSafe e edite aqui. Cada chamada guarda o preço do momento em que aconteceu.",
  Model: "Modelo",
  Provider: "Provedor",
  Input: "Entrada",
  Output: "Saída",
  "Cache read": "Cache lido",
  "Cache write": "Cache gravado",
  "Add model": "Adicionar modelo",
  "Save settings": "Salvar configurações",
  "Settings saved.": "Configurações salvas.",

  // Relatório
  "Close to the daily cap": "Perto do teto do dia",
  "You already used {pct} of today's AI cap ({spent} of US$ {cap}).":
    "Você já usou {pct} do teto de IA de hoje ({spent} de US$ {cap}).",
  "User {name} used {pct} of today's cap ({spent} of US$ {cap}).":
    "O usuário {name} usou {pct} do teto de hoje ({spent} de US$ {cap}).",
  "Workspace {name} used {pct} of today's cap ({spent} of US$ {cap}).":
    "O workspace {name} usou {pct} do teto de hoje ({spent} de US$ {cap}).",
  "Today you used {pct} of your daily cap ({spent} of US$ {cap}).":
    "Hoje você usou {pct} do seu teto diário ({spent} de US$ {cap}).",
  Period: "Período",
  Today: "Hoje",
  "Last 7 days": "Últimos 7 dias",
  "Last 30 days": "Últimos 30 dias",
  "This month": "Mês atual",
  Custom: "Personalizado",
  From: "De",
  To: "Até",
  "All users": "Todos os usuários",
  "All workspaces": "Todos os workspaces",
  Agent: "Agente",
  "All agents": "Todos os agentes",
  "All providers": "Todos os provedores",
  "All models": "Todos os modelos",
  "Total spent": "Total gasto",
  Calls: "Chamadas",
  "{n} blocked by the cap": "{n} barradas pelo teto",
  "{n} calls": "{n} chamadas",
  "Tokens (input / output)": "Tokens (entrada / saída)",
  "cache: {read} read, {write} written": "cache: {read} lidos, {write} gravados",
  "Average cost": "Custo médio",
  "per conversation: {v}": "por conversa: {v}",
  "per answer: {v}": "por resposta: {v}",
  "Spending per day": "Gasto por dia",
  "No AI spending in this period.": "Nenhum gasto de IA nesse período.",
  "Who spends the most": "Quem mais gasta",
  "Per agent": "Por agente",
  "Per model": "Por modelo",
  "Today's cap per user": "Teto de hoje por usuário",
  "Today's cap per workspace": "Teto de hoje por workspace",
  "Nothing here yet.": "Nada aqui ainda.",
  "Nothing spent today.": "Nenhum gasto hoje.",
  "Could not load the spending report.": "Não deu pra carregar o relatório de gastos.",

  // Mensagens das rotas
  "API keys cannot use this route. Do it in the Lead Engine.": "Chave de API não usa essa rota. Faça isso no Lead Engine.",
  Unauthorized: "Entre de novo pra continuar.",
  "Only the platform admin can do this.": "Só o admin da plataforma pode fazer isso.",
  "Turn on two-step verification first.": "Ligue a verificação em duas etapas primeiro.",
  "Unknown provider.": "Provedor desconhecido.",
  "There is no key saved for this provider.": "Não tem chave salva pra esse provedor.",
  "Too many tests. Wait a few minutes and try again.": "Muitos testes seguidos. Espere alguns minutos e tente de novo.",
  "Invalid data.": "Dados inválidos.",
  "Invalid price table.": "Tabela de preços inválida.",
  "Every price must be a number from 0 to 1000 dollars per million tokens.":
    "Cada preço tem de ser um número de 0 a 1000 dólares por milhão de tokens.",
  "Choose Claude (Anthropic) or OpenAI.": "Escolha Claude (Anthropic) ou OpenAI.",
  "This model has no price in the table for this provider.": "Esse modelo não tem preço na tabela pra esse provedor.",
  "The daily cap must be a number from 0 to 10000 dollars.": "O teto diário tem de ser um número de 0 a 10000 dólares.",
  "The daily cap must be a number from 0 to 100000 dollars.": "O teto diário tem de ser um número de 0 a 100000 dólares.",
  "The exchange rate must be a number above 0.": "A cotação tem de ser um número maior que 0.",
  "Choose the start and end dates.": "Escolha a data de início e a de fim.",
  "The end date must be after the start date.": "A data de fim tem de ser depois da de início.",
  "Choose up to one year.": "Escolha no máximo um ano.",
  "This key does not look like an Anthropic key. It starts with sk-ant-.":
    "Essa chave não parece da Anthropic. Ela começa com sk-ant-.",
  "This key does not look like an OpenAI key. It starts with sk-.": "Essa chave não parece da OpenAI. Ela começa com sk-.",
  "This key does not look right. Paste it again, without spaces.": "Essa chave não parece certa. Cole de novo, sem espaços.",
  "The key works.": "A chave funciona.",
  "The provider refused this key. Check that you copied all of it.":
    "O provedor recusou essa chave. Confira se você copiou ela inteira.",
  "This key has no permission for this call.": "Essa chave não tem permissão pra essa chamada.",
  "The provider says the limit or the balance ran out. Check your plan and credits.":
    "O provedor diz que o limite ou o saldo acabou. Confira o seu plano e os créditos.",
  "No balance on this account. Add credits at the provider.": "Essa conta está sem saldo. Coloque créditos no provedor.",
  "The test model was not found for this key.": "O modelo do teste não foi encontrado pra essa chave.",
  "The provider is unstable right now. Try again in a few minutes.":
    "O provedor está instável agora. Tente de novo em alguns minutos.",
  "The provider answered with an error.": "O provedor respondeu com erro.",
  "The provider took too long to answer. Try again.": "O provedor demorou demais pra responder. Tente de novo.",
  "Could not reach the provider.": "Não deu pra falar com o provedor.",
};
