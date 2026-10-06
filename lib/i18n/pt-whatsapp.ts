/**
 * 2026-10-06: telas do WhatsApp (Conversas, Conexões, Agentes) e as mensagens
 * que as rotas /api/whatsapp/* devolvem. Português simples, "você", sem travessão.
 */
export const ptWhatsapp: Record<string, string> = {
  // Menu e abas
  Connections: "Conexões",
  Agents: "Agentes",

  // Aviso do servidor
  "WhatsApp is not ready on the server": "O WhatsApp ainda não está pronto no servidor",
  "WhatsApp is not turned on on the server yet (WHATSAPP_ENABLED).": "O WhatsApp ainda não foi ligado no servidor (WHATSAPP_ENABLED).",
  "The WhatsApp gateway is not configured on the server yet (OPENWA_BASE_URL and OPENWA_API_KEY).":
    "O gateway do WhatsApp ainda não foi configurado no servidor (OPENWA_BASE_URL e OPENWA_API_KEY).",
  "The server has no public https address for the webhook yet.": "O servidor ainda não tem um endereço público https pro webhook.",

  // Status do número
  "Connected now": "Conectado",
  "Waiting for the QR code": "Esperando o QR code",
  Starting: "Iniciando",
  "Restricted by WhatsApp": "Restrito pelo WhatsApp",
  "Banned by WhatsApp": "Banido pelo WhatsApp",
  "Wait…": "Espera…",

  // Conexões
  "Number connected. New messages show up in Conversations.": "Número conectado. As mensagens novas aparecem em Conversas.",
  "Number disconnected. Conversations, contacts and settings stay saved.":
    "Número desconectado. Conversas, contatos e configurações continuam salvos.",
  "The number is marked as disconnected here, but the gateway did not answer. Conversations, contacts and settings stay saved.":
    "O número ficou marcado como desconectado aqui, mas o gateway não respondeu. Conversas, contatos e configurações continuam salvos.",
  "Connect a WhatsApp number by reading the QR code with the phone. Disconnecting never deletes conversations, contacts or settings.":
    "Conecte um número de WhatsApp lendo o QR code com o celular. Desconectar nunca apaga conversas, contatos nem configurações.",
  "Connect number": "Conectar número",
  "No WhatsApp number connected yet": "Nenhum número de WhatsApp conectado ainda",
  "Use a dedicated number, never your main one: WhatsApp can ban numbers connected this way.":
    "Use um número só pra isso, nunca o seu principal: o WhatsApp pode banir número conectado desse jeito.",
  "New number": "Número novo",
  "The number shows up after you read the QR code.": "O número aparece depois que você ler o QR code.",
  "{c} conversations, {m} messages saved": "{c} conversas, {m} mensagens salvas",
  "QR code (experimental)": "QR code (experimental)",
  "Official API": "API oficial",
  "Show QR code": "Mostrar QR code",
  "Hide QR code": "Esconder QR code",
  "Disconnect this number?": "Desconectar este número?",
  "The Lead Engine stops receiving and sending messages on this number.": "O Lead Engine para de receber e de enviar mensagens por este número.",
  "Nothing is deleted: conversations, contacts, agents and PDFs stay saved. To use it again, read a new QR code.":
    "Nada é apagado: conversas, contatos, agentes e PDFs continuam salvos. Pra usar de novo, é só ler um QR code novo.",
  "QR code to connect WhatsApp": "QR code pra conectar o WhatsApp",
  "Generating the QR code…": "Gerando o QR code…",
  "Open WhatsApp on the phone of this number.": "Abra o WhatsApp no celular deste número.",
  "Tap the three dots (Android) or Settings (iPhone) and then Linked devices.":
    "Toque nos três pontinhos (Android) ou em Configurações (iPhone) e depois em Dispositivos conectados.",
  "Tap Link a device and point the camera at this code.": "Toque em Conectar um dispositivo e aponte a câmera pra este código.",
  "The code changes by itself every few seconds. Keep this page open until it says Connected.":
    "O código troca sozinho a cada poucos segundos. Deixe esta página aberta até aparecer Conectado.",
  "Connect a number by QR code": "Conectar um número pelo QR code",
  "This mode uses WhatsApp Web through our gateway. It is not the official WhatsApp API.":
    "Esse modo usa o WhatsApp Web pelo nosso gateway. Não é a API oficial do WhatsApp.",
  "Name to recognize this number (optional)": "Nome pra você reconhecer este número (opcional)",
  "Example: Store service": "Exemplo: Atendimento da loja",
  "Before you connect": "Antes de conectar",
  "WhatsApp does not allow unofficial connections. The number can be restricted or banned, and there is no appeal.":
    "O WhatsApp não permite conexão não oficial. O número pode ser restrito ou banido, e não tem recurso.",
  "Use a dedicated number, never your personal or main business number.": "Use um número só pra isso, nunca o seu pessoal nem o principal da empresa.",
  "Never send bulk messages from it. The agents start turned off and only answer people who wrote first.":
    "Nunca faça disparo em massa por ele. Os agentes começam desligados e só respondem quem escreveu primeiro.",
  "I understand the risk and this is a dedicated number.": "Entendo o risco e este é um número só pra isso.",
  "Connecting…": "Conectando…",
  "Generate QR code": "Gerar QR code",

  // Conversas
  "Not sent": "Não enviada",
  Read: "Lida",
  Delivered: "Entregue",
  "Search name, number or message": "Buscar nome, número ou mensagem",
  "Search conversations": "Buscar conversas",
  Filter: "Filtro",
  "All chats": "Todas",
  Unread: "Não lidas",
  "Nothing found.": "Nada encontrado.",
  "No WhatsApp conversations yet. When someone writes to your number, it shows up here.":
    "Nenhuma conversa de WhatsApp ainda. Quando alguém escrever pro seu número, aparece aqui.",
  "{n} unread": "{n} não lidas",
  "You can answer until {time}": "dá pra responder até {time}",
  "Resume agent": "Retomar agente",
  "Pause agent": "Pausar agente",
  "Back to drafts: you approve each answer": "Voltar pro rascunho: você aprova cada resposta",
  "Automatic on": "Automático ligado",
  "Send by itself": "Enviar sozinho",
  "The AI agent is paused in this conversation until {time}. You answer.": "O agente de IA está pausado nesta conversa até {time}. Quem responde é você.",
  "AI agent": "Agente de IA",
  "From the phone": "Pelo celular",
  "Message type not shown here (sticker, location or reaction)": "Tipo de mensagem que não aparece aqui (figurinha, localização ou reação)",
  "The 24 hour window is closed. WhatsApp only lets you answer within 24 hours of the contact's last message. When they write again, you can answer.":
    "A janela de 24 horas fechou. O WhatsApp só deixa responder até 24 horas depois da última mensagem do contato. Quando ele escrever de novo, você pode responder.",
  "This number is disconnected. Reconnect it in Connections to answer.": "Este número está desconectado. Reconecte em Conexões pra responder.",
  "Write a message": "Escreva uma mensagem",
  "Write a message (Enter sends, Shift+Enter breaks the line)": "Escreva uma mensagem (Enter envia, Shift+Enter quebra a linha)",
  "When you answer here, the AI agent pauses in this conversation for 24 hours.": "Quando você responde aqui, o agente de IA pausa nesta conversa por 24 horas.",
  "Let the agent send by itself in this conversation?": "Deixar o agente enviar sozinho nesta conversa?",
  "The agent answers without waiting for your approval, with a human delay before each message.":
    "O agente responde sem esperar a sua aprovação, com uma espera de gente antes de cada mensagem.",
  "It still stops when you answer, pauses at quiet hours and respects the 24 hour window and the daily AI spending cap.":
    "Ele continua parando quando você responde, pausa no horário de silêncio e respeita a janela de 24 horas e o teto diário de gasto com IA.",
  "AI draft: nothing is sent until you approve": "Rascunho da IA: nada sai antes de você aprovar",
  "Message {n} of the draft": "Mensagem {n} do rascunho",

  // Agentes
  "Three AI agents can answer the people who write to your number. They start turned off, and while the number is in draft mode every answer waits for your approval in Conversations.":
    "Três agentes de IA podem responder quem escreve pro seu número. Eles começam desligados e, com o número em rascunho, toda resposta espera a sua aprovação em Conversas.",
  "No AI key yet": "Ainda não tem chave de IA",
  "The agents use the AI keys registered in /admin > AI keys. Without one they stay quiet, even when turned on.":
    "Os agentes usam as chaves de IA cadastradas em /admin > Chaves de IA. Sem chave eles ficam quietos, mesmo ligados.",
  "Connect a number first": "Conecte um número primeiro",
  "The agents are set up for each connected number.": "Os agentes são configurados pra cada número conectado.",
  "Go to Connections": "Ir pra Conexões",
  Number: "Número",
  "Agents on this number": "Agentes neste número",
  "Turned off": "Desligado",
  "Turned on": "Ligado",
  "No agent answers on this number. You answer everything in Conversations.": "Nenhum agente responde neste número. Você responde tudo em Conversas.",
  "On, as drafts": "Ligado, em rascunho",
  "The agents you turn on below write the answer and it waits for you. You approve, edit or discard it in Conversations.":
    "Os agentes que você ligar aqui embaixo escrevem a resposta e ela espera por você. Você aprova, edita ou descarta em Conversas.",
  "Turn on at least one agent below, or nothing happens.": "Ligue pelo menos um agente aqui embaixo, senão nada acontece.",
  "About your business": "Sobre o seu negócio",
  "Base Comando: what you sell, how you talk, what the agent may promise": "Comando base: o que você vende, como você fala e o que o agente pode prometer",
  "Example: We are a dental clinic in Itapecerica da Serra. We answer in a friendly and short way. We never give a price for a treatment before the evaluation.":
    "Exemplo: Somos uma clínica odontológica em Itapecerica da Serra. Respondemos de um jeito simpático e curto. Nunca damos preço de tratamento antes da avaliação.",
  "Prices, deadlines and links the agent may quote (one per line)": "Preços, prazos e links que o agente pode citar (um por linha)",
  "Example: Evaluation costs R$ 80": "Exemplo: A avaliação custa R$ 80",
  "The agent never quotes a price, deadline, percentage or link that is not here or in the PDFs. If it does, the answer stays as a draft with a warning.":
    "O agente nunca cita preço, prazo, porcentagem ou link que não esteja aqui ou nos PDFs. Se citar, a resposta fica como rascunho com um aviso.",
  "Human rhythm": "Ritmo de gente",
  "Only used when you let the agent send by itself in a conversation. Drafts you approve go out in a few seconds.":
    "Só vale quando você deixa o agente enviar sozinho numa conversa. Rascunho que você aprova sai em poucos segundos.",
  "Wait before answering, from (seconds)": "Espera antes de responder, de (segundos)",
  "Wait before answering, up to (seconds)": "Espera antes de responder, até (segundos)",
  "Quiet hours start": "Início do horário de silêncio",
  "Quiet hours end": "Fim do horário de silêncio",
  "Automatic answers per day on this number, at most": "Respostas automáticas por dia neste número, no máximo",
  "During quiet hours and after the daily limit, answers stay as drafts. The daily AI spending cap is set in /admin.":
    "No horário de silêncio e depois do limite do dia, as respostas ficam como rascunho. O teto diário de gasto com IA fica no /admin.",
  "Turn on {agent}": "Ligar {agent}",
  "Instructions for this agent": "Instruções pra este agente",
  "Example: Ask the person's name and what they need before talking about price.": "Exemplo: Pergunte o nome da pessoa e o que ela precisa antes de falar de preço.",
  "This PDF was already sent to this agent.": "Esse PDF já foi enviado pra este agente.",
  "Could not send the PDF.": "Não deu pra enviar o PDF.",
  "PDFs this agent can consult": "PDFs que este agente pode consultar",
  "Up to 30 PDFs of 8 MB. They count for every number of this workspace.": "Até 30 PDFs de 8 MB. Valem pra todos os números deste workspace.",
  "Send PDF": "Enviar PDF",
  "No PDF yet.": "Nenhum PDF ainda.",
  "{n} pages": "{n} páginas",
  Ready: "Pronto",
  "Reading the PDF…": "Lendo o PDF…",
  "Could not read this PDF.": "Não deu pra ler este PDF.",
  "Talks to new people: finds out what they want and if your offer fits them.": "Conversa com gente nova: descobre o que a pessoa quer e se a sua oferta serve pra ela.",
  "Follows orders, bookings, quotes and purchases that are already in progress.": "Acompanha pedido, agendamento, orçamento e compra que já estão andando.",
  "Helps people who already bought and have a problem: access, delivery, exchange.": "Ajuda quem já comprou e tem um problema: acesso, entrega, troca.",
  "This PDF has a password. Send it without the password.": "Esse PDF tem senha. Envie sem a senha.",
  "This PDF has no text (only images). Send a PDF with selectable text.": "Esse PDF não tem texto (só imagem). Envie um PDF com texto que dá pra selecionar.",
  "This PDF has more than 200 pages.": "Esse PDF tem mais de 200 páginas.",
  "Missing the OpenAI key in /admin. Without it the agent cannot read PDFs.": "Falta a chave da OpenAI no /admin. Sem ela o agente não consegue ler PDF.",
  "The AI could not read this PDF now. Delete it and send it again.": "A IA não conseguiu ler esse PDF agora. Exclua e envie de novo.",
  "The server queue is off. Send it again in a minute.": "A fila do servidor está desligada. Envie de novo daqui a pouco.",

  // Mensagens das rotas /api/whatsapp/*
  "The WhatsApp gateway is not configured on the server yet.": "O gateway do WhatsApp ainda não foi configurado no servidor.",
  "The gateway refused the server key. Check OPENWA_API_KEY.": "O gateway recusou a chave do servidor. Confira o OPENWA_API_KEY.",
  "The WhatsApp gateway did not answer. Try again in a minute.": "O gateway do WhatsApp não respondeu. Tente de novo daqui a pouco.",
  "Number not found.": "Número não encontrado.",
  "Read and accept the risk notice before connecting a number.": "Leia e aceite o aviso de risco antes de conectar um número.",
  "WhatsApp is not turned on on the server yet.": "O WhatsApp ainda não foi ligado no servidor.",
  "This workspace already has 5 numbers.": "Este workspace já tem 5 números.",
  "Only numbers connected by QR code can reconnect here.": "Só número conectado por QR code reconecta aqui.",
  "Conversation not found.": "Conversa não encontrada.",
  "Write a message first.": "Escreva uma mensagem primeiro.",
  "The message is too long (4000 characters at most).": "A mensagem está grande demais (no máximo 4000 caracteres).",
  "Unknown action.": "Ação desconhecida.",
  "Draft not found.": "Rascunho não encontrado.",
  "This draft was already handled.": "Esse rascunho já foi tratado.",
  "Media not found.": "Mídia não encontrada.",
  "24 hours passed since the contact's last message. Now only they can restart the conversation.":
    "Passaram 24 horas da última mensagem do contato. Agora só ele pode puxar a conversa de novo.",
  "This contact has not written to you yet, so WhatsApp does not let you start the conversation here.":
    "Esse contato ainda não escreveu pra você, então o WhatsApp não deixa você começar a conversa por aqui.",
  "This conversation is paused.": "Esta conversa está pausada.",
  "This number is disconnected. Reconnect it in Connections.": "Este número está desconectado. Reconecte em Conexões.",
  "The draft is empty.": "O rascunho está vazio.",
  "Could not queue the message right now. Try again.": "Não deu pra colocar a mensagem na fila agora. Tente de novo.",
  "Something went wrong. Try again in a minute.": "Algo deu errado. Tente de novo daqui a pouco.",
  "Too many messages in a short time. Wait a moment.": "Muitas mensagens em pouco tempo. Espere um pouquinho.",
  "This message could not be sent.": "Essa mensagem não pôde ser enviada.",
};
