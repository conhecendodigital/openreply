/**
 * Etapa 6 (Quiz): PT das mensagens de validação (ISSUE_MESSAGES), dos nomes e
 * descrições dos modelos e dos nomes dos tipos de bloco. Chave = inglês do
 * código (lib/funnels/validate.ts e lib/funnels/templates.ts).
 */
export const ptFunnelsApi: Record<string, string> = {
  // Validação (o que falta pra publicar)
  "Add at least one screen": "Adicione pelo menos uma tela",
  "Two items have the same id ({block}) on screen {step}": "Dois itens têm o mesmo id ({block}) na tela {step}",
  "Two questions save the answer with the same name ({block})": "Duas perguntas guardam a resposta com o mesmo nome ({block})",
  "A button or option on screen {step} goes to a screen that does not exist":
    "Um botão ou opção da tela {step} leva pra uma tela que não existe",
  "The loading on screen {step} sends to a screen that does not exist":
    "O carregamento da tela {step} manda pra uma tela que não existe",
  "Screen {step} has more than one question; keep one question per screen":
    "A tela {step} tem mais de uma pergunta; deixe uma pergunta por tela",
  "Screen {step} has no way forward: add a button, a question or a loading":
    "A tela {step} não tem como avançar: coloque um botão, uma pergunta ou um carregamento",
  "The checkout button on screen {step} has no link: fill it in or set the default checkout in Settings":
    "O botão de checkout da tela {step} está sem link: preencha ou defina o checkout padrão nas Configurações",
  "A link on screen {step} does not start with https://": "Um link da tela {step} não começa com https://",
  "The video on screen {step} must be a YouTube, Vimeo or Panda Video link":
    "O vídeo da tela {step} precisa ser um link do YouTube, Vimeo ou Panda Video",
  "Confirm the testimonial on screen {step} is real and authorized":
    "Confirme que o depoimento da tela {step} é real e autorizado",
  "Confirm the before and after on screen {step} is a real, authorized result":
    "Confirme que o antes e depois da tela {step} é um resultado real e autorizado",
  "Fill in the price of the offer on screen {step}": "Preencha o preço da oferta da tela {step}",
  "The \"from\" price on screen {step} must be higher than the price":
    "O preço \"de\" da tela {step} precisa ser maior que o preço",
  "Fill in the number of guarantee days on screen {step}": "Preencha quantos dias de garantia na tela {step}",
  "The countdown on screen {step} has an invalid date": "O contador da tela {step} está com data inválida",
  "The countdown deadline on screen {step} has passed; it will not show":
    "O prazo do contador da tela {step} já passou; ele não vai aparecer",
  "Replace the text in brackets on screen {step}: {text}": "Troque o texto entre colchetes da tela {step}: {text}",
  "There are data fields but no privacy policy link; /privacy will be used":
    "Tem campo de dados mas sem link da política de privacidade; vamos usar /privacy",
  "No screen has a checkout button": "Nenhuma tela tem botão de checkout",
  "The colors are hard to read (contrast {n}); pick stronger colors":
    "As cores estão difíceis de ler (contraste {n}); escolha cores mais fortes",
  "The Pixel ID must have only digits (5 to 20)": "O ID do Pixel precisa ter só números (5 a 20)",
  "The question on screen {step} needs at least 2 options": "A pergunta da tela {step} precisa de pelo menos 2 opções",
  "The loading on screen {step} should be the last block": "O carregamento da tela {step} deve ser o último bloco",
  "The checkout on screen {step} is not Hotmart, Kiwify or Eduzz; check the link":
    "O checkout da tela {step} não é Hotmart, Kiwify nem Eduzz; confira o link",

  // Modelos prontos
  "Yes ladder + video offer": "Escada de sim + VSL",
  "6 screens with one button each, five small yeses and the video offer with checkout on the last one. Asks for no data.":
    "6 telas com um botão cada, cinco pequenos \"sim\" e a oferta em vídeo com checkout na última. Não pede nenhum dado.",
  "Diagnosis quiz with result": "Quiz de diagnóstico com resultado",
  "5 questions that become tags, a result that quotes the answers and the right offer for it.":
    "5 perguntas que viram etiquetas, um resultado que cita as respostas e a oferta certa pra ele.",
  "Bucket survey": "Baldes (segmenta e mostra a oferta certa)",
  "The first question splits the audience in 3 buckets and each one sees its own offer.":
    "A primeira pergunta separa o público em 3 baldes e cada um vê a sua oferta.",
  "Which path is yours": "Qual é o seu caminho",
  "3 quick questions recommend one of two products and explain why. A tie goes to the cheaper one.":
    "3 perguntas rápidas recomendam um entre dois produtos e explicam o porquê. Empate vai pro mais barato.",
  Blank: "Em branco",
  "One cover screen to build from scratch.": "Uma tela de capa pra montar do zero.",

  // Tipos de bloco
  Heading: "Título",
  Text: "Texto",
  "Image or GIF": "Imagem ou GIF",
  Video: "Vídeo",
  Button: "Botão",
  "Answer options": "Opções de resposta",
  "Data field": "Campo de dados",
  "Before and after": "Antes e depois",
  Testimonial: "Depoimento",
  Checklist: "Lista com check",
  Countdown: "Contador",
  Loading: "Carregamento",
  Offer: "Oferta",
  "Image gallery": "Galeria de imagens",
  Questions: "Perguntas frequentes",
  Spacer: "Espaço",
};
