/**
 * Português das telas de Fluxos (Etapa 3, 2026-10-07). Entra no `pt` principal
 * (lib/i18n/pt.ts) por spread, então a regra é a mesma: chave = texto em
 * inglês do código.
 */
export const ptFlows: Record<string, string> = {
  // Menu, topo e lista
  Flows: "Fluxos",
  Flow: "Fluxo",
  "New flow": "Novo fluxo",
  "No flows yet": "Nenhum fluxo ainda",
  "No trigger yet": "Sem gatilho ainda",
  "Build a conversation step by step: messages with buttons, conditions, tags and waits. Your campaigns keep working as they are; when a campaign and a flow match the same event, the campaign answers.":
    "Monte uma conversa passo a passo: mensagens com botões, condições, etiquetas e esperas. Suas campanhas continuam funcionando do jeito que estão; quando uma campanha e um fluxo pegam o mesmo evento, quem responde é a campanha.",
  "Start from scratch, or open a campaign and tap “Open as flow” to copy it into a new flow (the campaign stays on).":
    "Comece do zero, ou abra uma campanha e toque em “Abrir como fluxo” pra copiar ela num fluxo novo (a campanha continua ligada).",
  "{n} steps": "{n} passos",
  "edited {when}": "editado {when}",
  "from a campaign": "veio de uma campanha",
  Entered: "Entraram",
  Completed: "Terminaram",
  Inside: "Dentro agora",
  Runs: "Passagens",
  "Switched on": "Ligado",
  "Switched off": "Desligado",
  "Turn on": "Ligar",
  "Turn off": "Desligar",
  "Unpublished changes": "Mudanças não publicadas",
  "Publish the flow before turning it on.": "Publique o fluxo antes de ligar.",

  // Campanha → fluxo
  "Open as flow": "Abrir como fluxo",
  "Opening…": "Abrindo…",
  "Could not open the campaign as a flow": "Não deu pra abrir a campanha como fluxo",
  "Creates a new flow, off, copied from this campaign. The campaign stays on and untouched.":
    "Cria um fluxo novo, desligado, copiado desta campanha. A campanha continua ligada e do jeito que está.",
  "Copied from the campaign. The campaign stays on and untouched; this flow is off.":
    "Copiado da campanha. A campanha continua ligada e intacta; este fluxo está desligado.",
  "Made from a campaign.": "Feito a partir de uma campanha.",
  "Open the campaign": "Abrir a campanha",
  "Got it": "Entendi",

  // Construtor
  "← Flows": "← Fluxos",
  "Back to flows": "Voltar pros fluxos",
  "Flow not found.": "Fluxo não encontrado.",
  "Flow name": "Nome do fluxo",
  "Version {v}": "Versão {v}",
  "Save draft": "Salvar rascunho",
  "All saved": "Tudo salvo",
  "Save the flow first": "Salve o fluxo primeiro",
  Publish: "Publicar",
  "Publishing…": "Publicando…",
  Canvas: "Canvas",
  List: "Lista",
  "Tidy up": "Organizar",
  "not connected": "solto",
  Step: "Passo",
  Checks: "Checagem",
  "Checks ({n})": "Checagem ({n})",
  Report: "Relatório",
  "Delete flow": "Excluir fluxo",
  "{n} entered": "{n} entraram",
  "{n} finished": "{n} terminaram",
  "{n} inside now": "{n} dentro agora",
  "{n} passed": "{n} passaram",
  "{n} clicks": "{n} cliques",
  "{n} stopped": "{n} pararam",
  "A flow has at most {n} steps.": "Um fluxo tem no máximo {n} passos.",
  "The saved draft could not be read. It was reset to an empty flow.":
    "Não deu pra ler o rascunho salvo. Ele voltou pra um fluxo vazio.",
  "Draft saved. It only runs after you publish.": "Rascunho salvo. Ele só roda depois que você publicar.",
  "Fix the flow before publishing.": "Corrija o fluxo antes de publicar.",
  "The flow is on: the new version is used from the next step of each person. Publish?":
    "O fluxo está ligado: a versão nova vale a partir do próximo passo de cada pessoa. Publicar?",
  "Published (version {v}). The flow is on and uses it now.": "Publicado (versão {v}). O fluxo está ligado e já usa essa versão.",
  "Published (version {v}). The flow is still off: turn it on when you are ready.":
    "Publicado (versão {v}). O fluxo continua desligado: ligue quando estiver pronto.",
  "Flow off. People inside it stop on their next step.": "Fluxo desligado. Quem estava dentro para no próximo passo.",
  "Flow on. It answers what no active campaign takes.": "Fluxo ligado. Ele responde o que nenhuma campanha ligada pegar.",
  "Delete the flow “{name}”? Its report is deleted too.": "Excluir o fluxo “{name}”? O relatório dele vai junto.",
  "Turn the flow off before deleting it.": "Desligue o fluxo antes de excluir.",
  "The channel of this flow is not active: nothing is sent until it is connected again.":
    "O canal deste fluxo não está ativo: nada é enviado até ele ser conectado de novo.",
  "The flow is on with the published version. Your changes only run after Publish.":
    "O fluxo está ligado com a versão publicada. Suas mudanças só rodam depois de Publicar.",

  // Checagem
  "Everything checks out. The flow can be published.": "Tudo certo. O fluxo pode ser publicado.",
  "Fix before publishing": "Corrija antes de publicar",
  "Worth a look": "Vale dar uma olhada",
  "Active campaigns on the same trigger": "Campanhas ligadas no mesmo gatilho",
  "None. (Checked when the flow was opened.)": "Nenhuma. (Conferido quando o fluxo foi aberto.)",
  "A campaign always answers first. The flow only gets the events no active campaign takes.":
    "A campanha sempre responde primeiro. O fluxo só recebe os eventos que nenhuma campanha ligada pegar.",

  // Relatório
  "The report starts once the flow is published and turned on.": "O relatório começa quando o fluxo é publicado e ligado.",
  "Stopped here": "Pararam aqui",

  // Erros do servidor
  "Only a signed-in person can do this, in the Lead Engine.": "Só uma pessoa logada pode fazer isso, aqui no Lead Engine.",
  "The conversation link was not found on this account.": "O link de conversa não foi encontrado nesta conta.",
  "Connect an Instagram account first.": "Conecte uma conta do Instagram primeiro.",
  "Publish and turn flows on or off with their own buttons.": "Publicar, ligar e desligar têm botões próprios.",
  "A published flow stays on its account.": "Um fluxo publicado fica na conta dele.",
  "No connection. Try again.": "Sem conexão. Tenta de novo.",
  "Something went wrong: {error}": "Algo deu errado: {error}",

  // Ligar
  "Turn on “{name}”?": "Ligar “{name}”?",
  "From now on the flow sends DMs by itself to whoever fires the trigger, within Instagram's rules (24 h window, hourly limit, takeover).":
    "A partir de agora o fluxo manda DM sozinho pra quem disparar o gatilho, dentro das regras do Instagram (janela de 24 h, limite por hora, conversa assumida).",
  "Checking campaigns…": "Conferindo as campanhas…",
  "The channel is not active: nothing goes out until it is connected again.":
    "O canal não está ativo: nada sai até ele ser conectado de novo.",
  "The draft has changes that are not published. What runs is the last published version.":
    "O rascunho tem mudanças não publicadas. O que roda é a última versão publicada.",
  "These active campaigns take the same events and answer first. The flow only gets what they do not take:":
    "Estas campanhas ligadas pegam os mesmos eventos e respondem primeiro. O fluxo só recebe o que elas não pegarem:",
  "Nobody ever gets both. To move these people to the flow, turn the campaign off first.":
    "Ninguém recebe os dois. Pra levar essas pessoas pro fluxo, desligue a campanha antes.",
  "No active campaign takes the same events.": "Nenhuma campanha ligada pega os mesmos eventos.",
  "Turning on…": "Ligando…",

  // Painel do passo
  "— Nothing (the flow ends) —": "— Nada (o fluxo termina) —",
  "Create a new step": "Criar um passo novo",
  "Tap a step on the canvas to edit it, or add a new one.": "Toque num passo do canvas pra editar, ou adicione um novo.",
  "Edit the trigger": "Editar o gatilho",
  "The flow ends here for this person.": "O fluxo termina aqui pra essa pessoa.",
  "Delete this step? Links that pointed to it are removed.": "Excluir este passo? As ligações que apontavam pra ele saem junto.",
  "Delete step": "Excluir passo",
  "What starts the flow": "O que começa o fluxo",
  "One post": "Um post",
  "Any post": "Qualquer post",
  "Chosen post": "Post escolhido",
  open: "abrir",
  "Hide posts": "Esconder posts",
  "Any of my stories": "Qualquer story meu",
  "No story up right now.": "Nenhum story no ar agora.",
  "Tap the story. Until you pick one, any story counts.": "Toque no story. Até escolher um, vale qualquer story.",
  "Conversation link": "Link de conversa",
  "Only links without an active campaign reach the flow.": "Só links sem campanha ligada chegam no fluxo.",
  "Choose a link": "Escolha um link",
  "campaign on: {name}": "campanha ligada: {name}",
  "And the comment has": "E o comentário tem",
  "Any word": "Qualquer palavra",
  "Whole word only": "Só a palavra inteira",
  "The first message answers the comment in private. After it, Instagram only lets the flow write again once the person taps a button or replies.":
    "A primeira mensagem responde o comentário no privado. Depois dela, o Instagram só deixa o fluxo escrever de novo quando a pessoa toca num botão ou responde.",
  "First step": "Primeiro passo",
  Text: "Texto",
  "Hi {first_name}! Here is what you asked for…": "Oi, {first_name}! Aqui está o que você pediu…",
  Insert: "Inserir",
  "Image (optional)": "Imagem (opcional)",
  "An https:// link to a JPG or PNG. It goes before the text.": "Um link https:// de JPG ou PNG. Ela vai antes do texto.",
  "Buttons (up to 3)": "Botões (até 3)",
  "Goes to another step": "Vai pra outro passo",
  "Opens a link (tracked)": "Abre um link (rastreado)",
  "Remove button": "Remover botão",
  "Button {n} text": "Texto do botão {n}",
  "When tapped, goes to": "Quando tocar, vai pra",
  "Add button": "Adicionar botão",
  "This message waits for the person to tap a button. Each button decides where the flow goes.":
    "Esta mensagem espera a pessoa tocar num botão. Cada botão decide pra onde o fluxo vai.",
  "Then goes to": "Depois vai pra",
  Check: "Conferir",
  "Has a tag?": "Tem uma etiqueta?",
  "Which link": "Qual link",
  "Any link of this flow": "Qualquer link deste fluxo",
  "Links of: {summary}": "Links de: {summary}",
  "If yes, goes to": "Se sim, vai pra",
  "If no, goes to": "Se não, vai pra",
  "What to do": "O que fazer",
  "Add a tag": "Adicionar etiqueta",
  "Remove a tag": "Remover etiqueta",
  "Same tags as Contacts.": "As mesmas etiquetas dos Contatos.",
  "Note (optional)": "Recado (opcional)",
  "Shows up in the owner's notifications.": "Aparece nas notificações do dono.",
  "Draft text": "Texto do rascunho",
  "Why (optional)": "Por quê (opcional)",
  "The draft goes to Approvals. Nothing is sent until a person approves it.":
    "O rascunho vai pra Aprovações. Nada é enviado até uma pessoa aprovar.",
  "For how many hours (empty = until released)": "Por quantas horas (vazio = até liberar)",
  "The robot stops talking to this person and the conversation waits for you in the Inbox.":
    "O robô para de falar com essa pessoa e a conversa fica te esperando no Direct.",
  "Wait for": "Esperar",
  "Some time": "Um tempo",
  "The person's reply": "A resposta da pessoa",
  "How long": "Quanto tempo",
  "Up to 23 hours: Instagram closes the conversation after 24 h without a message from the person.":
    "Até 23 horas: o Instagram fecha a conversa depois de 24 h sem mensagem da pessoa.",
  "Give up after": "Desistir depois de",
  "Empty = 23 hours.": "Vazio = 23 horas.",
  "Only a text reply counts (a photo alone does not).": "Só resposta em texto conta (só uma foto não conta).",
  "When they reply, goes to": "Quando responder, vai pra",
  "If nobody replies, goes to": "Se ninguém responder, vai pra",

  // Canvas
  Then: "Depois",
  "Tap: {label}": "Toque: {label}",
  "When they reply": "Quando responder",
  "No reply in time": "Sem resposta a tempo",

  // Prévia
  "I want it!": "Eu quero!",
  "Commented on your live": "Comentou na sua live",
  "Commented on your post": "Comentou no seu post",
  "@{username} in my story": "@{username} no meu story",
  "Hi!": "Oi!",
  "Opened your conversation link": "Abriu seu link de conversa",
  "your account": "sua conta",
  "Preview · nothing is sent": "Prévia · nada é enviado",
  "Add a message to see it here.": "Adicione uma mensagem pra ver aqui.",
  "Tap a button to continue": "Toque num botão pra continuar",
  ok: "ok",
  "Type their reply…": "Digite a resposta da pessoa…",
  "Simulate: nobody replied": "Simular: ninguém respondeu",
  "Start over": "Recomeçar",
  "A human takes it from here": "Daqui pra frente, uma pessoa assume",
  "{time} later": "{time} depois",
  "Stopped: too many steps": "Parou: passos demais",

  // Rótulos (components/flows/flow-labels.ts)
  Trigger: "Gatilho",
  Message: "Mensagem",
  Condition: "Condição",
  Action: "Ação",
  End: "Fim",
  Yes: "Sim",
  No: "Não",
  "Reply to a story": "Resposta de story",
  "Conversation link (ig.me)": "Link de conversa (ig.me)",
  "Text, image and up to 3 buttons": "Texto, imagem e até 3 botões",
  "Splits into yes / no": "Divide em sim / não",
  "Tag, notify, draft or human": "Etiqueta, aviso, rascunho ou humano",
  "Minutes, hours or a reply": "Minutos, horas ou uma resposta",
  "The flow ends here": "O fluxo termina aqui",
  "{n} min": "{n} min",
  "Comment on a post (choose it)": "Comentário em post (escolha qual)",
  "(no text yet)": "(sem texto ainda)",
  "Follows the account?": "Segue a conta?",
  "Has the tag {tag}?": "Tem a etiqueta {tag}?",
  "Clicked the link?": "Clicou no link?",
  "Add tag {tag}": "Adicionar etiqueta {tag}",
  "Remove tag {tag}": "Remover etiqueta {tag}",
  "Notify the owner": "Avisar o dono",
  "Propose a draft for approval": "Propor rascunho pra aprovação",
  "Hand over to a human": "Passar pra um humano",
  "Wait {time}": "Esperar {time}",
  "Wait for a reply": "Aguardar resposta",
  "End of the flow": "Fim do fluxo",
  "Missing step ({id})": "Passo que não existe ({id})",

  // Checagem (códigos do lib/flows/validate.ts)
  "Connect the trigger to the first step": "Ligue o gatilho ao primeiro passo",
  "Choose the post (or any post)": "Escolha o post (ou qualquer post)",
  "Add at least one keyword (or any word)": "Coloque pelo menos uma palavra-chave (ou qualquer palavra)",
  "Choose the conversation link (ig.me)": "Escolha o link de conversa (ig.me)",
  "A link points to a step that no longer exists": "Uma ligação aponta pra um passo que não existe mais",
  "This step is not connected to the flow": "Este passo está solto, sem ligação com o fluxo",
  "The message text is empty": "O texto da mensagem está vazio",
  "With buttons the text must have at most 640 characters": "Com botões o texto pode ter no máximo 640 caracteres",
  "A button has no text": "Um botão está sem texto",
  "A button does not lead anywhere": "Um botão não leva a lugar nenhum",
  "A link button needs an https:// address": "Botão de link precisa de um endereço https://",
  "The image must be an https:// link": "A imagem precisa ser um link https://",
  "Choose the tag": "Escolha a etiqueta",
  "The draft text is empty": "O texto do rascunho está vazio",
  "A loop must pass through a button tap or a wait for reply": "Uma volta no fluxo precisa passar por um toque de botão ou por aguardar resposta",
  "The waits add up to 23 hours or more: Instagram's 24-hour window would close":
    "As esperas somam 23 horas ou mais: a janela de 24 horas do Instagram fecharia",
  "The first message answers the comment (private reply) and cannot carry an image":
    "A primeira mensagem responde o comentário (resposta privada) e não pode ter imagem",
  "After the reply to a comment, Instagram only allows another message once the person taps a button or answers. Add a button or a wait for reply before this message":
    "Depois da resposta ao comentário, o Instagram só deixa mandar outra mensagem quando a pessoa toca num botão ou responde. Coloque um botão ou um aguardar resposta antes desta mensagem",
  "Add at least one step after the trigger": "Adicione pelo menos um passo depois do gatilho",
  "Before the conversation opens, Instagram may not say whether the person follows: it counts as no":
    "Antes da conversa abrir, o Instagram pode não dizer se a pessoa segue: conta como não",
  "A draft can only be proposed while the conversation is open (after a tap or a reply)":
    "Rascunho só pode ser proposto com a conversa aberta (depois de um toque ou de uma resposta)",
  "This message waits for a button tap, so its plain next step is ignored":
    "Esta mensagem espera o toque num botão, então o \"depois vai pra\" dela é ignorado",

  // Avisos da conversão (lib/flows/convert.ts)
  "The public reply to the comment is not part of flows; the campaign keeps doing it":
    "A resposta pública no comentário não faz parte dos fluxos; a campanha continua fazendo",
  "The campaign also answers the words by DM; a flow has one trigger, so that part was not copied":
    "A campanha também responde as palavras por DM; um fluxo tem um gatilho só, então essa parte não foi copiada",
  "\"Next reel\" was not copied: choose the post in the trigger": "\"Próximo reel\" não foi copiado: escolha o post no gatilho",
  "Link buttons got new tracked links; the click history stays with the campaign":
    "Os botões de link ganharam links rastreados novos; o histórico de cliques fica com a campanha",
  "The campaign's sequence stops when the person replies; in the flow the steps are plain waits":
    "A sequência da campanha para quando a pessoa responde; no fluxo os passos são esperas simples",
  "After the reply to a comment, a follow-up only goes out once the person taps or answers: add a button or a wait for reply":
    "Depois da resposta ao comentário, o follow-up só sai quando a pessoa toca ou responde: coloque um botão ou um aguardar resposta",
  "A wait was adjusted to fit between 1 minute and 23 hours": "Uma espera foi ajustada pra ficar entre 1 minuto e 23 horas",

  // Relatório (resultados e status das passagens)
  "Private reply": "Resposta privada",
  Tagged: "Etiquetou",
  Notified: "Avisou",
  "Draft proposed": "Rascunho proposto",
  Skipped: "Pulou",
  Waited: "Esperou",
  Tapped: "Tocou",
  Clicked: "Clicou",
  Replied: "Respondeu",
  "Handed to a human": "Passou pra um humano",
  Stopped: "Parou",
  Error: "Erro",
  "Maybe sent (not resent)": "Talvez enviado (não reenviado)",
  Running: "Rodando",
  "Waiting (time)": "Esperando (tempo)",
  "Waiting for a reply": "Esperando resposta",
  "Waiting for a tap": "Esperando toque",
  "With a human": "Com um humano",
  "Stopped: 24 h window": "Parou: janela de 24 h",
  "Stopped: human took over": "Parou: alguém assumiu a conversa",
  "Stopped: flow or channel off": "Parou: fluxo ou canal desligado",
  "Stopped: limit reached": "Parou: limite atingido",
};
