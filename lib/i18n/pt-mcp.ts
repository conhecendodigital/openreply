/**
 * 2026-10-28: aba MCP em Configurações (components/mcp-connect-panel.tsx).
 * Português simples, "você", sem travessão.
 */
export const ptMcp: Record<string, string> = {
  "Could not load API keys": "Não deu pra carregar as chaves",
  "Could not create the key": "Não deu pra criar a chave",
  "Could not build the file. The server address looks wrong.": "Não deu pra montar o arquivo. O endereço do servidor parece errado.",
  "File downloaded. The key is inside it and will not be shown again. Run the file on your computer, never send it to anyone.":
    "Arquivo baixado. A chave está dentro dele e não aparece de novo. Rode o arquivo no seu computador e não mande pra ninguém.",
  'Revoke "{name}"? Anything using this key stops working right away.': 'Revogar "{name}"? Tudo que usa essa chave para de funcionar na hora.',
  "Never paste your key in the AI chat.": "Nunca cole a sua chave no chat da IA.",
  "A key typed in a chat can leak and the AI may refuse it. If you pasted one by mistake, revoke it in the list at the bottom of this tab and create another.":
    "Chave digitada num chat pode vazar e a IA pode recusar. Se você colou uma sem querer, revogue na lista no fim desta aba e crie outra.",
  "The AI controls your Lead Engine through the MCP server. You connect it once, outside the chat: by a file you run on your computer or by a field in the connector screen. The key only works in this workspace.":
    "A IA controla o seu Lead Engine pelo servidor MCP. Você conecta uma vez, fora do chat: por um arquivo que roda no seu computador ou por um campo na tela do conector. A chave só funciona neste workspace.",
  "Server address": "Endereço do servidor",
  "Workspace ID (information only, it is not a secret and does not replace the key)": "ID do workspace (só informação, não é segredo e não substitui a chave)",
  "Pick your system:": "Escolha o seu sistema:",
  "Click the button to download the connection file. It already has your key inside.": "Clique no botão pra baixar o arquivo de conexão. Ele já leva a sua chave dentro.",
  "Mac: open the Terminal, type chmod +x and drag the file in, press Enter, then run the file the same way. Or right-click the file and choose Open.":
    "Mac: abra o Terminal, digite chmod +x e arraste o arquivo pra lá, aperte Enter e rode o arquivo do mesmo jeito. Ou clique com o botão direito no arquivo e escolha Abrir.",
  "Windows: right-click the .ps1 file and choose Run with PowerShell.": "Windows: clique com o botão direito no arquivo .ps1 e escolha Executar com o PowerShell.",
  "Open Claude Code and type /mcp. The server leadengine should appear as connected.": "Abra o Claude Code e digite /mcp. O servidor leadengine deve aparecer como conectado.",
  "Download Claude Code file": "Baixar arquivo do Claude Code",
  "Click the button to download the connection file (same system chosen above).": "Clique no botão pra baixar o arquivo de conexão (mesmo sistema escolhido acima).",
  "Run it. It saves the key in a protected file on your computer and adds the server to the Codex config.toml, with the key in an environment variable, never inside config.toml.":
    "Rode o arquivo. Ele guarda a chave num arquivo protegido no seu computador e põe o servidor no config.toml do Codex, com a chave numa variável de ambiente, nunca dentro do config.toml.",
  "Close and reopen the terminal, then open Codex.": "Feche e abra o terminal de novo e depois abra o Codex.",
  "Download Codex file": "Baixar arquivo do Codex",
  "In Claude.ai go to Customize > Connectors > Add > Add custom connector.": "No Claude.ai vá em Customize > Connectors > Add > Add custom connector.",
  "Name: Lead Engine. Server URL: the address above.": "Nome: Lead Engine. URL do servidor: o endereço acima.",
  "Authentication: No sign in. In Request headers add the header Authorization and, as the value, paste what the button below copies (it starts with Bearer).":
    "Autenticação: No sign in. Em Request headers adicione o cabeçalho Authorization e, no valor, cole o que o botão abaixo copia (começa com Bearer).",
  "Paste only in that field of the connector screen, never in a conversation. Click Add.": "Cole só nesse campo da tela do conector, nunca numa conversa. Clique em Add.",
  "Claude connects from Anthropic's servers, so the Lead Engine must be reachable on the internet (it is). On Team and Enterprise plans only owners add connectors and everyone shares that key. Menu names can change; confirmed against the Claude help center on 28/10/2026.":
    "O Claude conecta a partir dos servidores da Anthropic, então o Lead Engine precisa estar acessível na internet (está). Nos planos Team e Enterprise só os donos adicionam conectores e todos dividem essa chave. Os nomes dos menus podem mudar; conferido na central de ajuda do Claude em 28/10/2026.",
  "Create key and copy header value": "Criar chave e copiar o valor do cabeçalho",
  "Copied. Paste it in the header field now. It will not be shown again.": "Copiado. Cole agora no campo do cabeçalho. Não aparece de novo.",
  "Copy again": "Copiar de novo",
  "Not available yet. The ChatGPT custom connector (Settings > Apps and connectors, with developer mode on) accepts OAuth or no authentication; sending a fixed key in a header was not confirmed in the documentation. Connecting ChatGPT without a key needs sign-in with OAuth, which the Lead Engine does not offer yet. Use Claude or Codex for now. Do not paste the key in the ChatGPT chat.":
    "Ainda não disponível. O conector personalizado do ChatGPT (Configurações > Apps e conectores, com o modo desenvolvedor ligado) aceita OAuth ou nenhuma autenticação; mandar uma chave fixa num cabeçalho não foi confirmado na documentação. Conectar o ChatGPT sem chave pede login por OAuth, que o Lead Engine ainda não tem. Por enquanto use o Claude ou o Codex. Não cole a chave no chat do ChatGPT.",
  "Active keys": "Chaves ativas",
  "never": "nunca",
  "A key reads, creates things turned off and proposes drafts. Turning on, sending, deleting and managing members or keys stay with a person. Each key has a limit of 300 requests per minute.":
    "Uma chave lê, cria coisas desligadas e propõe rascunhos. Ligar, enviar, apagar e mexer em membros ou chaves ficam com uma pessoa. Cada chave tem limite de 300 pedidos por minuto.",
  "Too many active keys. Revoke the ones you no longer use.": "Chaves ativas demais. Revogue as que você não usa mais.",
};
