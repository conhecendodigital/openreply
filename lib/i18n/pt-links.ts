/**
 * Português da prévia e do domínio dos links (07/10/2026). Entra no `pt`
 * principal (lib/i18n/pt.ts) por spread. Regra de sempre: chave = texto em
 * inglês do código.
 */
export const ptLinks: Record<string, string> = {
  // Campanha: prévia do link
  "Link preview": "Prévia do link",
  "What Instagram and WhatsApp show in the link's card. Empty fields come from the quiz cover or from the page of the link.":
    "O que o Instagram e o WhatsApp mostram no cartão do link. O que ficar vazio vem da capa do quiz ou da página do link.",
  "Preview title": "Título da prévia",
  "Preview description": "Descrição da prévia",
  "Preview image link (https://)": "Link da imagem da prévia (https://)",
  "Use an https:// image link": "Use um link de imagem com https://",
  "Best size: 1200 x 630 pixels.": "Tamanho ideal: 1200 x 630 pixels.",
  "+ Change the link preview": "+ Mudar a prévia do link",
  // Quiz: imagem de compartilhamento
  "This is the image of the card when the quiz link is shared (Instagram, WhatsApp). Best size: 1200 x 630 pixels. Without one, the first image of the cover goes.":
    "É a imagem do cartão quando o link do quiz é compartilhado (Instagram, WhatsApp). Tamanho ideal: 1200 x 630 pixels. Sem ela, vai a primeira imagem da capa.",
  // Canais: domínio dos links
  "Link domain": "Domínio dos links",
  "Links use the Lead Engine address": "Os links usam o endereço do Lead Engine",
  "The link that goes in the DM uses this domain, short: one code per person. Point the domain to the Lead Engine first (DNS, Cloudflare and Dokploy), then save it here.":
    "O link que vai na DM usa esse domínio, curtinho: um código por pessoa. Primeiro aponte o domínio pro Lead Engine (DNS, Cloudflare e Dokploy), depois salve aqui.",
  "Domain": "Domínio",
  "How the link looks:": "Como o link fica:",
  "Checking...": "Conferindo...",
  "Remove": "Remover",
  "Configured": "Configurado",
  "Saved. The next DMs go with this domain.": "Salvo. As próximas DMs já vão com esse domínio.",
  "Stop using this domain? The next DMs go with the Lead Engine address. Links already sent keep working.":
    "Parar de usar esse domínio? As próximas DMs vão com o endereço do Lead Engine. Os links que já foram continuam funcionando.",
  "This does not look like a domain. Type only the address, like comando.yoursite.com.":
    "Isso não parece um domínio. Digite só o endereço, tipo comando.seusite.com.br.",
  "Use a public domain of yours, not a local or internal name.": "Use um domínio público seu, não um nome local ou interno.",
  "This is already the Lead Engine address. Type a domain of yours.": "Esse já é o endereço do Lead Engine. Digite um domínio seu.",
  "Another workspace already uses this domain.": "Outro workspace já usa esse domínio.",
  "This domain does not reach the Lead Engine yet. Point it here first (DNS, Cloudflare and Dokploy) and try again.":
    "Esse domínio ainda não chega no Lead Engine. Aponte ele pra cá primeiro (DNS, Cloudflare e Dokploy) e tente de novo.",
  "Too many changes. Wait a few minutes.": "Mudanças demais. Espere uns minutos.",
};
