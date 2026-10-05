/**
 * Etapa 6: ready-made funnels (etapa6/modelos-e-checklists.md). Browser-safe.
 *
 * The funnel texts are PT on purpose (they are the funnel's content, not
 * the app's). Where real data is missing they carry [brackets], and
 * validateFunnel blocks publishing until every bracket is replaced. Nothing
 * is invented: price null, guarantee days null, testimonials and before and
 * after not authorized, checkout empty, images on the ".invalid" host (never
 * loads; the player shows a "Coloque sua imagem" box instead) and the offer
 * video on the placeholder id XXXXXXXXXXX.
 */
import {
  FUNNEL_SCHEMA_VERSION,
  type FunnelBlock,
  type FunnelDefinition,
  type FunnelOption,
  type FunnelSettings,
  type FunnelStep,
} from "@/lib/funnels/types";
import { DEFAULT_THEME, emptyFunnelDefinition } from "@/lib/funnels/schema";

export type FunnelTemplate = {
  id: string;
  /** English, i18n key. */
  name: string;
  /** English, i18n key. */
  description: string;
  namePt: string;
  build(): FunnelDefinition;
};

const IMG = (name: string) => `https://troque.invalid/${name}.jpg`;
const VIDEO_PLACEHOLDER = "https://www.youtube.com/watch?v=XXXXXXXXXXX";

function settings(extra: Partial<FunnelSettings> = {}): FunnelSettings {
  return { theme: { ...DEFAULT_THEME }, pixelConsent: "banner", ...extra };
}

function definition(steps: FunnelStep[], extra: Partial<FunnelSettings> = {}): FunnelDefinition {
  return { schemaVersion: FUNNEL_SCHEMA_VERSION, settings: settings(extra), steps };
}

const opt = (id: string, label: string, tag?: string, score?: number, goto?: string): FunnelOption => ({
  id,
  label,
  ...(tag ? { tag } : {}),
  ...(score !== undefined ? { score } : {}),
  ...(goto ? { goto } : {}),
});

const next = (id: string, label: string): FunnelBlock => ({ id, type: "button", label, action: { kind: "next" } });
const checkout = (id: string, label: string, style: "primary" | "secondary" = "primary"): FunnelBlock => ({
  id,
  type: "button",
  label,
  action: { kind: "checkout" },
  style,
});
const QUESTION_HEADER = { showBack: true, showProgress: true };

// ─── Modelo A: escada de sim + VSL (6 telas, igual ao do Dailton) ───────────
function escadaSimVsl(): FunnelDefinition {
  return definition(
    [
      {
        id: "s_capa",
        title: "Capa",
        blocks: [
          { id: "b_capa_imagem", type: "image", url: IMG("capa"), alt: "[Sua foto ou GIF olhando pra câmera]", rounded: true },
          {
            id: "b_capa_titulo",
            type: "heading",
            level: 1,
            align: "center",
            text: "Descubra como [resultado que a pessoa quer] em [prazo real que você entrega]",
          },
          {
            id: "b_capa_texto",
            type: "text",
            align: "center",
            text: "Sem precisar de [esforço 1 que ela odeia], [esforço 2] nem [esforço 3].",
          },
          next("b_capa_botao", "Quero descobrir"),
        ],
      },
      {
        id: "s_crenca",
        title: "A crença",
        blocks: [
          {
            id: "b_crenca_texto",
            type: "text",
            text: "Vão te oferecer mil atalhos. Mas o que faz [resultado] acontecer de verdade é:",
          },
          { id: "b_crenca_lista", type: "checklist", items: ["[pilar 1]", "[pilar 2]", "[pilar 3]", "[pilar 4]"] },
          {
            id: "b_crenca_fecho",
            type: "text",
            text: "Parece pouco, né? Pois é. Muita gente trava porque mistura tudo e não faz o básico bem feito.",
          },
          next("b_crenca_botao", "Quero fazer o básico bem feito"),
        ],
      },
      {
        id: "s_mecanismo",
        title: "O que você vai aprender",
        blocks: [
          { id: "b_mecanismo_titulo", type: "heading", level: 2, text: "No [nome do produto] você vai aprender a:" },
          {
            id: "b_mecanismo_lista",
            type: "checklist",
            items: [
              "Usar o Comando certo para [tarefa 1]",
              "[resultado concreto 2]",
              "[resultado concreto 3]",
              "[resultado concreto 4]",
              "[resultado concreto 5]",
            ],
          },
          {
            id: "b_mecanismo_galeria",
            type: "gallery",
            images: [
              { url: IMG("aula-1"), alt: "[Print real de uma aula ou tela do produto]" },
              { url: IMG("aula-2"), alt: "[Print real de uma aula ou tela do produto]" },
              { url: IMG("aula-3"), alt: "[Print real de uma aula ou tela do produto]" },
            ],
          },
          next("b_mecanismo_botao", "É disso que eu preciso"),
        ],
      },
      {
        id: "s_prova",
        title: "Prova",
        blocks: [
          {
            id: "b_prova_titulo",
            type: "heading",
            level: 2,
            text: "[Nome real, com autorização] era [situação antes]. Hoje [situação depois].",
          },
          {
            id: "b_prova_antes_depois",
            type: "compare",
            before: { title: "Antes", imageUrl: IMG("antes"), items: ["[como era antes, com o resultado real]"] },
            after: { title: "Depois", imageUrl: IMG("depois"), items: ["[como ficou depois, com o resultado real]"] },
            authorized: false,
          },
          next("b_prova_botao", "Eu também quero isso"),
        ],
      },
      {
        id: "s_objecao",
        title: "A objeção",
        blocks: [
          {
            id: "b_objecao_titulo",
            type: "heading",
            level: 2,
            text: "\"Mas isso não funciona pra [objeção comum: meu nicho, quem é iniciante, quem não tem tempo]\"",
          },
          { id: "b_objecao_texto", type: "text", text: "[Resposta curta e honesta à objeção, em 2 frases]." },
          {
            id: "b_objecao_galeria",
            type: "gallery",
            images: [
              { url: IMG("resultado-1"), alt: "[Print real de resultado ou mensagem, com autorização]" },
              { url: IMG("resultado-2"), alt: "[Print real de resultado ou mensagem, com autorização]" },
            ],
          },
          next("b_objecao_botao", "Já estou pronto"),
        ],
      },
      {
        id: "s_oferta",
        title: "Oferta",
        blocks: [
          { id: "b_oferta_video", type: "video", url: VIDEO_PLACEHOLDER, title: "[Vídeo da oferta]" },
          checkout("b_oferta_botao_video", "Quero o [nome do produto]"),
          {
            id: "b_oferta_missao",
            type: "text",
            text: "Meu objetivo com você: [o que a pessoa consegue fazer depois, em 1 frase].",
          },
          {
            id: "b_oferta_recebe",
            type: "checklist",
            title: "O que você recebe",
            items: ["[entregável 1]", "[entregável 2]", "[entregável 3]"],
          },
          { id: "b_oferta_bonus", type: "checklist", title: "Bônus", items: ["[bônus real 1]", "[bônus real 2]"] },
          {
            id: "b_oferta_preco",
            type: "offer",
            title: "[nome do produto]",
            priceCents: null,
            compareAtCents: null,
            installmentsText: "[parcelamento, se houver]",
            guaranteeDays: null,
            guaranteeText:
              "Você tem [N] dias de garantia. Se não fizer sentido pra você, pede o reembolso direto na [Hotmart] e recebe tudo de volta.",
          },
          {
            id: "b_oferta_faq",
            type: "faq",
            items: [
              { q: "Como recebo o acesso?", a: "[Como e quando a pessoa recebe o acesso depois do pagamento]." },
              { q: "Serve pra quem está começando?", a: "[Resposta honesta pra quem está começando]." },
              { q: "E se eu não gostar?", a: "[Como funciona a garantia, em 1 ou 2 frases]." },
            ],
          },
          checkout("b_oferta_botao_final", "Quero começar agora"),
        ],
      },
    ],
    { footerText: "Pagamento processado pela [Hotmart]." }
  );
}

// ─── Modelo B: quiz de diagnóstico com resultado ────────────────────────────
function resultStep(n: 1 | 2 | 3, name: string, text: string): FunnelStep {
  return {
    id: `s_resultado_${n}`,
    title: `Resultado ${n}`,
    blocks: [
      { id: `b_resultado_${n}_titulo`, type: "heading", level: 1, text: `Seu resultado: ${name}` },
      { id: `b_resultado_${n}_texto`, type: "text", text },
      {
        id: `b_resultado_${n}_porque`,
        type: "text",
        text:
          "**Por que esse resultado:**\n- Seu objetivo: {resposta.p1}\n- Hoje: {resposta.p2}\n- O que mais te atrapalha: {resposta.p3}",
      },
      {
        id: `b_resultado_${n}_botao`,
        type: "button",
        label: "Ver o meu próximo passo",
        action: { kind: "goto", stepId: "s_oferta" },
      },
    ],
  };
}

function quizDiagnostico(): FunnelDefinition {
  const question = (
    id: string,
    title: string,
    name: string,
    q: string,
    options: FunnelOption[]
  ): FunnelStep => ({
    id,
    title,
    header: QUESTION_HEADER,
    blocks: [{ id: `b_${name}`, type: "options", name, question: q, multiple: false, options }],
  });
  return definition([
    {
      id: "s_capa",
      title: "Capa",
      blocks: [
        { id: "b_capa_titulo", type: "heading", level: 1, text: "Descubra em 1 minuto o que está te travando em [tema]" },
        {
          id: "b_capa_texto",
          type: "text",
          text: "São 5 perguntas rápidas. No fim você vê o seu resultado e o próximo passo.",
        },
        next("b_capa_botao", "Começar"),
      ],
    },
    question("s_p1", "P1 Objetivo", "p1", "O que você mais quer agora com [tema]?", [
      opt("o_p1_a", "[objetivo A]", "quiz:objetivo-a"),
      opt("o_p1_b", "[objetivo B]", "quiz:objetivo-b"),
      opt("o_p1_c", "[objetivo C]", "quiz:objetivo-c"),
      opt("o_p1_nao_sei", "Ainda não sei", "quiz:objetivo-indefinido"),
    ]),
    question("s_p2", "P2 Situação atual", "p2", "Hoje, como você usa [ferramenta ou tema]?", [
      opt("o_p2_nunca", "Nunca usei", "quiz:nivel-zero", 0),
      opt("o_p2_as_vezes", "Uso de vez em quando", "quiz:nivel-iniciante", 1),
      opt("o_p2_semana", "Uso toda semana", "quiz:nivel-intermediario", 2),
      opt("o_p2_dia", "Uso todo dia no trabalho", "quiz:nivel-avancado", 3),
    ]),
    question("s_p3", "P3 Maior bloqueio", "p3", "O que mais te atrapalha?", [
      opt("o_p3_1", "[bloqueio 1, nas palavras do público]", "quiz:bloqueio-1"),
      opt("o_p3_2", "[bloqueio 2]", "quiz:bloqueio-2"),
      opt("o_p3_3", "[bloqueio 3]", "quiz:bloqueio-3"),
      opt("o_p3_outro", "Outro", "quiz:bloqueio-outro"),
    ]),
    {
      id: "s_insight",
      title: "Mini insight",
      header: QUESTION_HEADER,
      blocks: [
        {
          id: "b_insight_texto",
          type: "text",
          text:
            "Faz sentido. Quem está em \"{resposta.p3}\" costuma [explicação curta e verdadeira do porquê]. Mais 2 perguntas e você vê o seu resultado.",
        },
        next("b_insight_botao", "Continuar"),
      ],
    },
    question("s_p4", "P4 Tempo disponível", "p4", "Quanto tempo por dia você tem para isso?", [
      opt("o_p4_curto", "Menos de 15 minutos", "quiz:tempo-curto"),
      opt("o_p4_medio", "15 a 30 minutos", "quiz:tempo-medio"),
      opt("o_p4_longo", "Mais de 30 minutos", "quiz:tempo-longo"),
    ]),
    question("s_p5", "P5 Compromisso", "p5", "Se você tivesse o passo a passo certo, começaria quando?", [
      opt("o_p5_hoje", "Hoje", "quiz:quente"),
      opt("o_p5_semana", "Essa semana", "quiz:morno"),
      opt("o_p5_olhando", "Só estou olhando", "quiz:frio"),
    ]),
    {
      id: "s_carregando",
      title: "Carregamento",
      blocks: [
        {
          id: "b_carregando",
          type: "loading",
          text: "Montando o seu resultado a partir das suas respostas…",
          durationSec: 3,
          // Pontos só da P2 (nível): 0 a 1, 2, 3.
          routes: [
            { max: 1, stepId: "s_resultado_1" },
            { min: 2, max: 2, stepId: "s_resultado_2" },
            { min: 3, stepId: "s_resultado_3" },
          ],
        },
      ],
    },
    resultStep(
      1,
      "Começando do zero",
      "Você quer {resposta.p1} e ainda está começando. O que mais vai te ajudar agora é [1 coisa simples]."
    ),
    resultStep(
      2,
      "Já usa, mas sem método",
      "Você já usa [ferramenta], mas trava em {resposta.p3}. O que falta é [o método ou o Comando certo]."
    ),
    resultStep(3, "Pronto pra escalar", "Você já tem prática. O próximo passo é [ganho de escala]."),
    {
      id: "s_oferta",
      title: "Oferta",
      blocks: [
        {
          id: "b_oferta_titulo",
          type: "heading",
          level: 2,
          text: "Para quem está no seu momento, o [produto] foi feito pra [benefício]",
        },
        {
          id: "b_oferta_recebe",
          type: "checklist",
          title: "O que você recebe",
          items: ["[entregável 1]", "[entregável 2]", "[entregável 3]"],
        },
        {
          id: "b_oferta_preco",
          type: "offer",
          title: "[produto]",
          priceCents: null,
          compareAtCents: null,
          guaranteeDays: null,
          guaranteeText: "Você tem [N] dias de garantia. Se não fizer sentido pra você, pede o reembolso e recebe tudo de volta.",
        },
        {
          id: "b_oferta_faq",
          type: "faq",
          items: [
            { q: "Como recebo o acesso?", a: "[Como e quando a pessoa recebe o acesso]." },
            { q: "E se eu não gostar?", a: "[Como funciona a garantia]." },
          ],
        },
        checkout("b_oferta_botao", "Quero começar agora"),
      ],
    },
  ]);
}

// ─── Modelo C: baldes (segmenta e mostra a oferta do balde) ─────────────────
function branch(key: "a" | "b" | "c"): FunnelStep[] {
  const up = key.toUpperCase();
  return [
    {
      id: `s_${key}_situacao`,
      title: `Balde ${up}: situação`,
      header: QUESTION_HEADER,
      blocks: [
        {
          id: `b_${key}_situacao`,
          type: "options",
          name: `${key}_situacao`,
          question: `Hoje, como está [tema] pra você? (balde ${up})`,
          multiple: false,
          options: [
            opt(`o_${key}_sit_1`, "[situação 1, nas palavras do público]"),
            opt(`o_${key}_sit_2`, "[situação 2]"),
            opt(`o_${key}_sit_3`, "[situação 3]"),
          ],
        },
      ],
    },
    {
      id: `s_${key}_desafio`,
      title: `Balde ${up}: desafio`,
      header: QUESTION_HEADER,
      blocks: [
        {
          id: `b_${key}_desafio`,
          type: "options",
          name: `${key}_desafio`,
          question: "Qual é o seu maior desafio agora?",
          multiple: false,
          options: [
            opt(`o_${key}_des_1`, `[desafio 1 do balde ${up}]`, `quiz:${key}-desafio-1`),
            opt(`o_${key}_des_2`, `[desafio 2 do balde ${up}]`, `quiz:${key}-desafio-2`),
            opt(`o_${key}_des_3`, `[desafio 3 do balde ${up}]`, `quiz:${key}-desafio-3`),
          ],
        },
      ],
    },
    {
      id: `s_${key}_oferta`,
      title: `Balde ${up}: oferta`,
      blocks: [
        { id: `b_${key}_oferta_titulo`, type: "heading", level: 2, text: `[Promessa da oferta pra quem é do balde ${up}]` },
        { id: `b_${key}_oferta_texto`, type: "text", text: "[Por que essa oferta resolve o desafio de quem está aqui, em 2 frases]." },
        {
          id: `b_${key}_oferta_preco`,
          type: "offer",
          title: `[produto do balde ${up}]`,
          priceCents: null,
          compareAtCents: null,
          guaranteeDays: null,
          guaranteeText: "Você tem [N] dias de garantia. Se não fizer sentido pra você, pede o reembolso e recebe tudo de volta.",
        },
        checkout(`b_${key}_oferta_botao`, "Quero começar agora"),
      ],
    },
  ];
}

function baldes(): FunnelDefinition {
  return definition([
    {
      id: "s_capa",
      title: "Capa",
      blocks: [
        { id: "b_capa_titulo", type: "heading", level: 1, text: "Responda 3 perguntas e veja o caminho certo pra você" },
        next("b_capa_botao", "Começar"),
      ],
    },
    {
      id: "s_balde",
      title: "Pergunta-balde",
      header: QUESTION_HEADER,
      blocks: [
        {
          id: "b_balde",
          type: "options",
          name: "balde",
          question: "Você quer usar [tema] mais para:",
          multiple: false,
          options: [
            opt("o_balde_a", "[balde A]", "balde:a", undefined, "s_a_situacao"),
            opt("o_balde_b", "[balde B]", "balde:b", undefined, "s_b_situacao"),
            opt("o_balde_c", "[balde C]", "balde:c", undefined, "s_c_situacao"),
          ],
        },
      ],
    },
    ...branch("a"),
    ...branch("b"),
    ...branch("c"),
  ]);
}

// ─── Modelo D: qual é o seu caminho (recomenda 1 entre 2 produtos) ───────────
// Pontos: +1 = produto A, -1 = produto B. Empate (0) vai para o produto A,
// que deve ser o MAIS BARATO: troque a faixa de empate se o seu mais barato
// for o B. Nunca empurrar o mais caro por padrão.
function recommendation(key: "a" | "b"): FunnelStep {
  const other = key === "a" ? "b" : "a";
  const up = key.toUpperCase();
  return {
    id: `s_rec_${key}`,
    title: `Recomendação: produto ${up}`,
    blocks: [
      { id: `b_rec_${key}_titulo`, type: "heading", level: 1, text: `Pra você, o melhor começo é o [produto ${up}]` },
      {
        id: `b_rec_${key}_motivos`,
        type: "text",
        text:
          "**Por que:**\n- Você prefere {resposta.preferencia}\n- Sobre tempo: {resposta.tempo}\n- Com [ferramenta]: {resposta.uso}",
      },
      checkout(`b_rec_${key}_botao`, `Quero o [produto ${up}]`),
      {
        id: `b_rec_${key}_outra`,
        type: "button",
        label: "Ver a outra opção",
        style: "secondary",
        action: { kind: "goto", stepId: `s_rec_${other}` },
      },
    ],
  };
}

function qualCaminho(): FunnelDefinition {
  const q = (id: string, title: string, name: string, question: string, options: FunnelOption[]): FunnelStep => ({
    id,
    title,
    header: QUESTION_HEADER,
    blocks: [{ id: `b_${name}`, type: "options", name, question, multiple: false, options }],
  });
  return definition([
    {
      id: "s_capa",
      title: "Capa",
      blocks: [
        {
          id: "b_capa_titulo",
          type: "heading",
          level: 1,
          text: "Qual é o melhor jeito de você começar com [tema]? Descubra em 30 segundos.",
        },
        next("b_capa_botao", "Começar"),
      ],
    },
    q("s_q1", "Preferência", "preferencia", "Você prefere:", [
      opt("o_q1_a", "Copiar e usar Comandos prontos", undefined, 1),
      opt("o_q1_b", "Aprender a conversar com a IA do seu jeito", undefined, -1),
    ]),
    q("s_q2", "Tempo", "tempo", "Quanto tempo você quer investir pra começar?", [
      opt("o_q2_a", "Quero resultado hoje", undefined, 1),
      opt("o_q2_b", "Topo estudar um pouco", undefined, -1),
    ]),
    q("s_q3", "Uso", "uso", "Você já usa [ferramenta]?", [
      opt("o_q3_nao", "Ainda não", undefined, -1),
      opt("o_q3_trava", "Uso, mas trava", undefined, 1),
      opt("o_q3_bem", "Uso bem", undefined, 1),
    ]),
    {
      id: "s_carregando",
      title: "Carregamento",
      blocks: [
        {
          id: "b_carregando",
          type: "loading",
          text: "Juntando as suas respostas…",
          durationSec: 2,
          routes: [
            { min: 1, stepId: "s_rec_a" },
            { max: -1, stepId: "s_rec_b" },
            // Empate: o mais barato (troque pra s_rec_b se o mais barato for o B).
            { min: 0, max: 0, stepId: "s_rec_a" },
          ],
        },
      ],
    },
    recommendation("a"),
    recommendation("b"),
  ]);
}

export const FUNNEL_TEMPLATES: FunnelTemplate[] = [
  {
    id: "escada-sim-vsl",
    name: "Yes ladder + video offer",
    description:
      "6 screens with one button each, five small yeses and the video offer with checkout on the last one. Asks for no data.",
    namePt: "Escada de sim + VSL",
    build: escadaSimVsl,
  },
  {
    id: "quiz-diagnostico",
    name: "Diagnosis quiz with result",
    description: "5 questions that become tags, a result that quotes the answers and the right offer for it.",
    namePt: "Quiz de diagnóstico com resultado",
    build: quizDiagnostico,
  },
  {
    id: "baldes",
    name: "Bucket survey",
    description: "The first question splits the audience in 3 buckets and each one sees its own offer.",
    namePt: "Baldes (segmenta e mostra a oferta certa)",
    build: baldes,
  },
  {
    id: "qual-caminho",
    name: "Which path is yours",
    description: "3 quick questions recommend one of two products and explain why. A tie goes to the cheaper one.",
    namePt: "Qual é o seu caminho",
    build: qualCaminho,
  },
  {
    id: "em-branco",
    name: "Blank",
    description: "One cover screen to build from scratch.",
    namePt: "Em branco",
    build: emptyFunnelDefinition,
  },
];

export function getFunnelTemplate(id: string): FunnelTemplate | null {
  return FUNNEL_TEMPLATES.find((t) => t.id === id) ?? null;
}
