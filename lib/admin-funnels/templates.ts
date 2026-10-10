/**
 * Modelos de funil da aba "Funis" (só admin). Estratégias conhecidas, montadas
 * com as peças que o Lead Engine já tem. Texto nos dois idiomas aqui mesmo
 * (não passa pelo t()), escolhido pela língua da tela.
 *
 * Nada de número inventado: "olhe" diz qual número acompanhar, sem prometer taxa.
 */

type Txt = { pt: string; en: string };

export type FunnelTemplateStep = {
  title: Txt;
  /** Peça do Lead Engine que monta esta etapa (link interno), ou null se é fora dele. */
  tool: { href: string; label: Txt } | null;
  detail: Txt;
};

export type FunnelTemplate = {
  id: string;
  name: Txt;
  goal: Txt;
  /** Pra que tipo de oferta serve. */
  fits: Txt;
  steps: FunnelTemplateStep[];
  watch: Txt;
};

const campaigns = { href: "/campaigns", label: { pt: "Campanhas", en: "Campaigns" } };
const quizzes = { href: "/quizzes", label: { pt: "Quizzes", en: "Quizzes" } };
const broadcasts = { href: "/broadcasts", label: { pt: "Disparos", en: "Broadcasts" } };
const flows = { href: "/flows", label: { pt: "Fluxos", en: "Flows" } };
const segments = { href: "/segments", label: { pt: "Segmentos", en: "Segments" } };
const waLeads = { href: "/whatsapp/leads", label: { pt: "Leads do WhatsApp", en: "WhatsApp leads" } };
const inbox = { href: "/inbox", label: { pt: "Caixa de entrada", en: "Inbox" } };

export const FUNNEL_TEMPLATES: FunnelTemplate[] = [
  {
    id: "aplicacao",
    name: { pt: "Aplicação pra serviço ou ticket alto", en: "Application for a service or high ticket" },
    goal: { pt: "Conversar só com quem tem dinheiro e dor, e fechar no WhatsApp.", en: "Talk only to people with budget and pain, and close on WhatsApp." },
    fits: { pt: "Agente de WhatsApp, montagem feita junto, mentoria.", en: "WhatsApp agent, done-with-you setup, mentoring." },
    steps: [
      { title: { pt: "Post com dor de negócio", en: "Post about a business pain" }, tool: null, detail: { pt: "Mostra o problema do cliente e o resultado pronto. Pede uma palavra no comentário.", en: "Show the client's problem and the finished result. Ask for a keyword in the comments." } },
      { title: { pt: "DM em conversa", en: "Conversational DM" }, tool: campaigns, detail: { pt: "Primeira mensagem pergunta o que a pessoa vende. Nada de link na primeira.", en: "First message asks what the person sells. No link in the first one." } },
      { title: { pt: "Perguntas de qualificação", en: "Qualifying questions" }, tool: quizzes, detail: { pt: "4 perguntas: o que vende, quanto fatura, o que já tentou, quanto pode investir. Pede o WhatsApp.", en: "4 questions: what they sell, revenue, what they tried, budget. Ask for WhatsApp." } },
      { title: { pt: "Conversa no WhatsApp", en: "WhatsApp conversation" }, tool: waLeads, detail: { pt: "Quem qualificou vai pro estágio certo e recebe a proposta.", en: "Qualified people move to the right stage and get the proposal." } },
    ],
    watch: { pt: "Aplicações por dia e quantas viram venda.", en: "Applications per day and how many become sales." },
  },
  {
    id: "quiz-oferta",
    name: { pt: "Quiz até a oferta (ticket baixo)", en: "Quiz to offer (low ticket)" },
    goal: { pt: "Diagnóstico rápido que entrega um presente e mostra a oferta certa pra cada perfil.", en: "Quick diagnosis that gives a gift and shows the right offer per profile." },
    fits: { pt: "Curso ou produto de até uns R$100.", en: "Course or product up to about R$100." },
    steps: [
      { title: { pt: "Comentário vira DM com o link", en: "Comment becomes a DM with the link" }, tool: campaigns, detail: { pt: "Palavra-chave no post, DM curta com botão pro quiz.", en: "Keyword on the post, short DM with a button to the quiz." } },
      { title: { pt: "3 perguntas e o WhatsApp", en: "3 questions and the WhatsApp" }, tool: quizzes, detail: { pt: "Pede o contato ANTES do resultado (\"pra onde eu mando?\"), senão quem sai some.", en: "Ask for contact BEFORE the result (\"where should I send it?\"), or whoever leaves is gone." } },
      { title: { pt: "Resultado por perfil", en: "Result per profile" }, tool: quizzes, detail: { pt: "Quem usa pra rotina vê uma oferta; quem vende ou cria conteúdo vê outra.", en: "Personal use sees one offer; sellers and creators see another." } },
      { title: { pt: "Oferta curta", en: "Short offer" }, tool: quizzes, detail: { pt: "Preço e botão já na primeira tela da oferta. Vídeo opcional, botão sem espera.", en: "Price and button on the first offer screen. Optional video, no button delay." } },
      { title: { pt: "Recuperação em 24 h", en: "24 h recovery" }, tool: broadcasts, detail: { pt: "Quem viu a oferta e não comprou recebe uma pergunta: o que faltou?", en: "Whoever saw the offer and didn't buy gets one question: what was missing?" } },
    ],
    watch: { pt: "% de quem vê a oferta e clica no checkout, e compras confirmadas pela Hotmart.", en: "% of offer viewers who click checkout, and purchases confirmed by Hotmart." },
  },
  {
    id: "recuperacao",
    name: { pt: "Recuperação de quem clicou e não comprou", en: "Recover people who clicked and didn't buy" },
    goal: { pt: "Ouvir a objeção e transformar quem sumiu em conversa.", en: "Hear the objection and turn whoever left into a conversation." },
    fits: { pt: "Qualquer oferta que já tem cliques.", en: "Any offer that already gets clicks." },
    steps: [
      { title: { pt: "Separar quem clicou", en: "Separate the clickers" }, tool: segments, detail: { pt: "Segmento com a etiqueta clicou e sem compra.", en: "Segment with the clicked tag and no purchase." } },
      { title: { pt: "Pergunta aberta", en: "Open question" }, tool: broadcasts, detail: { pt: "\"O que faltou pra você entrar?\" Só vai pra quem falou com a conta nas últimas 24 h.", en: "\"What was missing for you to join?\" Only reaches people who talked to the account in the last 24 h." } },
      { title: { pt: "Responder cada objeção", en: "Answer each objection" }, tool: inbox, detail: { pt: "As respostas viram texto da página e da oferta.", en: "The answers become copy for the page and offer." } },
    ],
    watch: { pt: "Respostas recebidas e as objeções que mais aparecem.", en: "Replies received and the most common objections." },
  },
  {
    id: "lista-espera",
    name: { pt: "Teste de demanda (lista de espera)", en: "Demand test (waitlist)" },
    goal: { pt: "Ver se o público quer um produto antes de construir.", en: "Check if people want a product before building it." },
    fits: { pt: "Produto novo, como o editor de vídeo com IA.", en: "New product, like the AI video editor." },
    steps: [
      { title: { pt: "Post com antes e depois", en: "Before and after post" }, tool: null, detail: { pt: "Mostra o resultado do produto funcionando, sem preço.", en: "Show the product's result working, no price." } },
      { title: { pt: "Palavra-chave entra na lista", en: "Keyword joins the list" }, tool: campaigns, detail: { pt: "DM confirma a lista e marca a etiqueta.", en: "DM confirms the list and tags the person." } },
      { title: { pt: "Pergunta de preço", en: "Price question" }, tool: flows, detail: { pt: "Fluxo pergunta quanto a pessoa pagaria e pra que usaria.", en: "Flow asks what the person would pay and what for." } },
    ],
    watch: { pt: "Quantos entram na lista. Só construir se passar da meta que você definir.", en: "How many join. Only build if it passes the goal you set." },
  },
];

export const templateText = (txt: Txt, lang: "pt" | "en") => txt[lang] ?? txt.pt;
