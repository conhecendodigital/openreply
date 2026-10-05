/**
 * 2026-10-11: Pixel padrão da conta e API de Conversões da Meta
 * (Configurações, components/meta-capi-panel.tsx).
 */
export const ptCapi: Record<string, string> = {
  "Meta Pixel and Conversions API": "Pixel e API de Conversões da Meta",
  "The quizzes send Lead, InitiateCheckout and the Hotmart Purchase to Meta from the server too, with the same event id as the Pixel in the browser, so nothing is counted twice. It only sends when the visitor accepted the cookies (or when the quiz only informs).":
    "Os quizzes também mandam Lead, InitiateCheckout e o Purchase da Hotmart pra Meta direto do servidor, com o mesmo id de evento do Pixel do navegador, então nada é contado duas vezes. Só manda quando a pessoa aceitou os cookies (ou quando o quiz só avisa).",
  "Default Pixel ID": "ID do Pixel padrão",
  "Only the number. A quiz without its own Pixel uses this one.":
    "Só o número. O quiz que não tiver Pixel próprio usa este.",
  "Conversions API access token": "Token de acesso da API de Conversões",
  "Paste the token here": "Cole o token aqui",
  "In the Events Manager: your Pixel, Settings, Conversions API, Generate access token. It is saved encrypted and never shown again.":
    "No Gerenciador de Eventos: seu Pixel, Configurações, API de Conversões, Gerar token de acesso. Ele é guardado criptografado e nunca mais aparece.",
  "Keep the saved token": "Manter o token salvo",
  "Token saved, ends in ••••{last4}": "Token salvo, termina em ••••{last4}",
  "Test event code (optional)": "Código de evento de teste (opcional)",
  "From the Test events tab of the Events Manager. While it is filled, the events show up there to check. Clear it when you are done.":
    "Da aba Eventos de teste do Gerenciador de Eventos. Enquanto estiver preenchido, os eventos aparecem lá pra você conferir. Apague quando terminar.",
  "Saved.": "Salvo.",
  "Sending...": "Enviando...",
  "Send test event": "Enviar evento de teste",
  "Could not load these settings.": "Não deu pra carregar essas configurações.",
  "This token does not look like a Meta token. Copy it again from the Events Manager.":
    "Esse token não parece um token da Meta. Copie de novo no Gerenciador de Eventos.",
  "The test event code has only letters and numbers, like TEST12345.":
    "O código de teste tem só letras e números, tipo TEST12345.",
  "Only owners and admins can change this.": "Só o dono e os admins podem mudar isso.",
  "Could not save. Try again.": "Não deu pra salvar. Tente de novo.",
  "Remove the Conversions API token? The quizzes stop sending events from the server. The Pixel in the browser keeps working.":
    "Remover o token da API de Conversões? Os quizzes param de mandar eventos pelo servidor. O Pixel do navegador continua funcionando.",
  "Save the Pixel ID and the token first.": "Salve o ID do Pixel e o token primeiro.",
  "Meta did not accept the token. It may be wrong or expired. Generate a new one in the Events Manager and save it again.":
    "A Meta não aceitou o token. Ele pode estar errado ou vencido. Gere um novo no Gerenciador de Eventos e salve de novo.",
  "Meta did not find this Pixel, or the token has no access to it. Check the Pixel ID.":
    "A Meta não achou esse Pixel, ou o token não tem acesso a ele. Confira o ID do Pixel.",
  "The token has no permission for this Pixel. Generate the token inside this Pixel's settings in the Events Manager.":
    "O token não tem permissão pra esse Pixel. Gere o token dentro das configurações desse Pixel no Gerenciador de Eventos.",
  "Meta took too long to answer. Try again in a moment.": "A Meta demorou pra responder. Tente de novo daqui a pouco.",
  "Could not reach Meta right now. Try again.": "Não deu pra falar com a Meta agora. Tente de novo.",
  "Meta refused the event.": "A Meta recusou o evento.",
  "Meta accepted the event ({n} received).": "A Meta aceitou o evento ({n} recebido).",
  "Open the Test events tab of the Events Manager to see it.":
    "Abra a aba Eventos de teste do Gerenciador de Eventos pra ver.",
  "Without a test code it counts as a real PageView.": "Sem código de teste, ele conta como um PageView de verdade.",
  "What Meta said:": "O que a Meta disse:",
  "Empty = uses the account Pixel (Settings, Pixel and Conversions API). Without one there either, no Pixel and no cookie notice. Only the number: the script is ours.":
    "Vazio = usa o Pixel da conta (Configurações, Pixel e API de Conversões). Sem Pixel lá também, fica sem Pixel e sem aviso de cookies. Só o número: o script é nosso.",
};
