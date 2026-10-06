/**
 * Português do formato da DM (06/10/2026): cartão com botão ou texto com o
 * link dentro. Entra no `pt` principal (lib/i18n/pt.ts) por spread.
 * Regra de sempre: chave = texto em inglês do código.
 */
export const ptDmFormato: Record<string, string> = {
  "DM format": "Formato da DM",
  "Text with the link": "Texto com link",
  "Card with a button": "Cartão com botão",
  "Text with a link shows for everyone, even in Requests. The card with a button looks nicer, but some Instagram versions do not show it.":
    "Texto com link aparece pra todo mundo, inclusive em Solicitações. O cartão com botão é mais bonito, mas em algumas versões do Instagram não aparece.",
  "Without {link}, the link goes at the end, on its own line. The second link goes on the line below, with its label. The opening DM and the follow request keep their button.":
    "Sem {link}, o link vai no fim, numa linha própria. O segundo link vai na linha de baixo, com o rótulo. A DM de abertura e o pedido pra seguir continuam com botão.",
  "your second link": "seu segundo link",
};
