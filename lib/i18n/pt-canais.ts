/**
 * 2026-10-06: Canais > Conexões e chaves (components/integrations-panel.tsx),
 * o aviso em Configurações e o item Admin do menu.
 */
export const ptCanais: Record<string, string> = {
  "Connections and keys": "Conexões e chaves",
  "Paste and change here the keys of the services the Lead Engine uses. What you save here counts before the server settings. Keys are saved encrypted and never show again: you only see the last 4 characters.":
    "Cole e troque aqui as chaves dos serviços que o Lead Engine usa. O que você salva aqui vale antes da configuração do servidor. As chaves ficam guardadas criptografadas e nunca mais aparecem: você só vê os 4 últimos caracteres.",
  "Could not load the keys. Try again in a moment.": "Não deu pra carregar as chaves. Tente de novo daqui a pouco.",
  "WhatsApp on the server:": "WhatsApp no servidor:",
  "on.": "ligado.",
  "off. The server owner turns it on with WHATSAPP_ENABLED=1. The keys below can be saved now and start working when it is on.":
    "desligado. Quem cuida do servidor liga com WHATSAPP_ENABLED=1. Você já pode salvar as chaves abaixo: elas passam a valer quando ligar.",
  "WhatsApp · uazapi": "WhatsApp · uazapi",
  "WhatsApp · OpenWA gateway": "WhatsApp · gateway OpenWA",
  "WhatsApp · Official API (Cloud API)": "WhatsApp · API oficial (Cloud API)",
  "Coming after Meta approves the app. There is nothing to paste here yet.":
    "Chega depois da aprovação da Meta. Ainda não tem nada pra colar aqui.",
  "Where to get it: in the uazapi panel, copy the Server URL and the Admin Token.":
    "Onde pegar: no painel da uazapi, copie a Server URL e o Admin Token.",
  "Where to get it: in your OpenWA gateway, copy its https address and an API key with the operator role.":
    "Onde pegar: no seu gateway OpenWA, copie o endereço https dele e uma chave de API com o papel operator.",
  "Server URL": "Server URL",
  "Admin token": "Admin token",
  "Devices in your plan": "Dispositivos do plano",
  "How many WhatsApp numbers your uazapi plan allows. Empty uses 2.":
    "Quantos números de WhatsApp o seu plano da uazapi permite. Vazio usa 2.",
  "Gateway URL": "URL do gateway",
  "Operator key": "Chave operator",
  "https://yourname.uazapi.com": "https://seunome.uazapi.com",
  "https://gateway.yourdomain.com": "https://gateway.seudominio.com",
  "Paste the Admin token here": "Cole o Admin token aqui",
  "Paste the operator key here": "Cole a chave operator aqui",
  "Using what you saved here": "Usando o que você salvou aqui",
  "Using the server settings": "Usando a configuração do servidor",
  "Not configured": "Não configurado",
  Configured: "Configurada",
  "Fill in the address and the key here. Until both are saved, the server settings keep counting.":
    "Preencha o endereço e a chave aqui. Enquanto os dois não estiverem salvos, continua valendo a configuração do servidor.",
  "Saved: {n}": "Salvo: {n}",
  "Saved, ends in ••••{last4}": "Salvo, termina em ••••{last4}",
  "Changed by {who} on {when}": "Trocado por {who} em {when}",
  "Changed on {when}": "Trocado em {when}",
  Change: "Trocar",
  Remove: "Remover",
  Cancel: "Cancelar",
  "Replace the saved value?": "Trocar o valor salvo?",
  "Remove the saved value?": "Remover o valor salvo?",
  "The old value stops working right away. Numbers already connected keep their conversations.":
    "O valor antigo para de valer na hora. Os números já conectados continuam com as conversas.",
  "Without it, the server settings count again (if there are any). Nothing else is deleted.":
    "Sem ele, volta a valer a configuração do servidor (se tiver). Nada mais é apagado.",
  "Yes, replace": "Sim, trocar",
  "Yes, remove": "Sim, remover",
  "This address does not look right. Copy it again, starting with https://":
    "Esse endereço não parece certo. Copie de novo, começando com https://",
  "Use an address that starts with https://": "Use um endereço que começa com https://",
  "This address points to an internal network. Use the public https address of the service.":
    "Esse endereço aponta pra uma rede interna. Use o endereço público https do serviço.",
  "This key does not look right. Copy it again, without spaces.": "Essa chave não parece certa. Copie de novo, sem espaços.",
  "Type a whole number from 1 to 100.": "Digite um número inteiro de 1 a 100.",
  "Too many tries. Wait a few minutes and try again.": "Muitas tentativas. Espere uns minutos e tente de novo.",
  "API keys cannot change this. Do it here, signed in.": "Chave de API não muda isso. Faça aqui, logado.",
  "The test failed.": "O teste falhou.",
  "Connection OK. The server has {n} numbers created.": "Conexão OK. O servidor tem {n} números criados.",
  "Connection OK.": "Conexão OK.",
  "Nothing configured yet. Save the address and the key first.": "Nada configurado ainda. Salve o endereço e a chave primeiro.",
  "The service refused the key. Check if you copied the right one.": "O serviço recusou a chave. Confira se você copiou a certa.",
  "The service took too long to answer. Try again in a moment.": "O serviço demorou pra responder. Tente de novo daqui a pouco.",
  "Could not reach this address. Check the URL.": "Não deu pra chegar nesse endereço. Confira a URL.",
  "The service answered something unexpected. Check the URL.": "O serviço respondeu algo inesperado. Confira a URL.",
  "with what you saved here": "com o que você salvou aqui",
  "with the server settings": "com a configuração do servidor",
  "AI keys (platform)": "Chaves de IA (plataforma)",
  "Only you see this": "Só você vê isso",
  "These keys are for the whole platform, not only this workspace. You change them in Admin, AI keys.":
    "Essas chaves valem pra plataforma toda, não só pra este workspace. Você troca em Admin, Chaves de IA.",
  "Open AI keys in Admin": "Abrir Chaves de IA no Admin",
  "Recent changes": "Últimas mudanças",
  "{who} {action} {what}": "{who} {action} {what}",
  Someone: "Alguém",
  saved: "salvou",
  replaced: "trocou",
  removed: "removeu",
  "tested the connection of": "testou a conexão de",
  // Configurações: o Pixel e a API de Conversões foram pra Canais.
  "The Meta Pixel and the Conversions API moved to Channels, in Connections and keys. Everything you saved is still there.":
    "O Pixel e a API de Conversões da Meta foram pra Canais, em Conexões e chaves. Tudo o que você salvou continua lá.",
  "Open Connections and keys": "Abrir Conexões e chaves",
  // Mensagens do servidor (lib/whatsapp/painel*.ts), traduzidas na tela do WhatsApp.
  "The WhatsApp gateway is not configured yet. Add the URL and the key in Channels, Connections and keys.":
    "O gateway do WhatsApp ainda não foi configurado. Coloque a URL e a chave em Canais, Conexões e chaves.",
  "The gateway refused the key. Check it in Channels, Connections and keys.":
    "O gateway recusou a chave. Confira em Canais, Conexões e chaves.",
  "The uazapi is not configured yet. Add the Server URL and the Admin token in Channels, Connections and keys.":
    "A uazapi ainda não foi configurada. Coloque a Server URL e o Admin token em Canais, Conexões e chaves.",
  "The uazapi refused the Admin token. Check it in Channels, Connections and keys.":
    "A uazapi recusou o Admin token. Confira em Canais, Conexões e chaves.",
  "Could not read the keys saved in Channels. Try again in a minute.":
    "Não deu pra ler as chaves salvas em Canais. Tente de novo daqui a um minuto.",
  "Not available yet: the uazapi is not configured (Channels, Connections and keys).":
    "Ainda não disponível: a uazapi não foi configurada (Canais, Conexões e chaves).",
  "Not available: the OpenWA gateway is not configured (Channels, Connections and keys).":
    "Não disponível: o gateway OpenWA não foi configurado (Canais, Conexões e chaves).",
  "No WhatsApp provider is configured yet. Add the uazapi or the OpenWA gateway in Channels, Connections and keys.":
    "Nenhum provedor de WhatsApp foi configurado ainda. Coloque a uazapi ou o gateway OpenWA em Canais, Conexões e chaves.",
  "Only owners and admins see the connection keys.": "Só o dono e os admins veem as chaves de conexão.",
  // Menu: item Admin (só pro admin da plataforma).
  "Platform admin": "Admin da plataforma",
  "Turn on two-step verification to open Admin.": "Ligue a verificação em duas etapas pra abrir o Admin.",
};
