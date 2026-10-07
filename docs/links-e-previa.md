# Links rastreados: prévia bonita e link curto

Data: 07/10/2026. Branch: `feat/link-previa-curto`.

Pedido do dono: a DM em texto mostrava a prévia do link com a marca do Lead Engine ("Lead Engine · Automação de Instagram, Direct e quiz pela API oficial da Meta") e um link enorme (`https://many.leadenginer.com/r/njuGA_aEXw?c=860289347105772.zNh6z7WTcclu`). "A prévia desse link não teria como ser uma capa do quiz, alguma coisa diferente, porque isso aí também tá feio."

## O que muda

### 1. A prévia do link

Quando o Instagram, o WhatsApp, o Telegram e cia. abrem o link pra montar o cartão, o Lead Engine responde só com as meta tags (`og:title`, `og:description`, `og:image`, `og:url`, `twitter:card`). Esse acesso **não conta clique** e não redireciona. Pessoa de verdade continua indo direto pro destino (302) e o clique é contado como antes.

Robôs reconhecidos: `facebookexternalhit`, `Facebot`, `meta-externalagent`, `WhatsApp`, `Instagram` (o robô, não o navegador do app), `TelegramBot`, `Twitterbot`, `Slackbot`, `LinkedInBot`, `Discordbot` e outros. Pedido `HEAD` também nunca conta. O navegador de dentro do Instagram (quando a pessoa toca no link) é tratado como pessoa.

De onde vem cada campo do cartão, nessa ordem:

1. **Prévia do link** da campanha: título, descrição e imagem que você coloca na tela da campanha, logo abaixo do link ("+ Mudar a prévia do link"). A imagem pode ser um link `https://` ou um arquivo enviado (mesmo armazenamento das imagens do quiz).
2. **Capa do quiz**, quando o link vai pra um quiz do Lead Engine (`quiz.cloudmatheus.com.br/<slug>`, `many.leadenginer.com/q/<slug>` ou um endereço que redireciona pra ele, como `comando.cloudmatheus.com.br/diag`): título e descrição de "Busca e compartilhamento" do quiz e a **imagem de compartilhamento**. Sem essa imagem, vai a primeira imagem da capa (GIF vai como está, os apps mostram o primeiro quadro).
3. As tags `og:*` da **página de destino** (Hotmart, site...). O Lead Engine só lê endereços `https` públicos (nada de rede interna), segue no máximo 3 redirecionamentos, espera no máximo 3 segundos e guarda o resultado por 10 minutos.
4. Se nada disso tiver: só o **nome do link** (ou o domínio do destino). Nunca a marca do Lead Engine.

Cada campo vem do primeiro que tiver: dá pra pôr só o título na campanha e deixar a imagem vir da capa do quiz.

A página pública do quiz também passou a ter essas tags (quando alguém compartilha o link do quiz direto). A imagem do Lead Engine não aparece mais no cartão do quiz.

**Imagem de compartilhamento do quiz:** Quizzes > o quiz > Configurações > Busca e compartilhamento > "Link da imagem de compartilhamento" ou "Enviar arquivo". Tamanho ideal: 1200 x 630 pixels. Depois de mudar, publique o quiz de novo.

### 2. O link curto

Formato novo: `https://<domínio>/r/<slug>/<código>`, por exemplo `https://comando.cloudmatheus.com.br/r/njuGA_aEXw/k3J9xQ2`.

- `<código>` tem 7 letras e números e diz quem recebeu (tabela `TrackedLinkRecipient`). A mesma pessoa recebe sempre o mesmo código daquele link.
- O clique é creditado ao contato e à DM que levou o link, igual ao `?c=` de antes.
- **O formato antigo continua funcionando**: os links que já foram (`/r/<slug>?c=...`) não quebram.
- Se o banco não conseguir salvar o código na hora, a DM sai com o link antigo (`?c=`). Ela nunca sai sem link.
- O worker monta o link curto no texto e no botão. A resposta pública no comentário usa o domínio também (sem pessoa no link).

### 3. Domínio dos links

Canais > Conexões e chaves > **Domínio dos links**. Só dono e admin, logados (chave de API recebe 403).

- Você digita o domínio (ex.: `comando.cloudmatheus.com.br`). Ao salvar, o Lead Engine confere se o domínio já chega nele (`https://<domínio>/r/_ping`). Se ainda não chega, não salva: senão todos os links das próximas DMs quebrariam.
- Nesse domínio o Lead Engine **só responde `/r/*`** (e os ícones). Painel, API, login, quiz: tudo 404. Se você quiser que o mesmo domínio mostre quiz também, coloque ele em `QUIZ_DOMAINS`.
- Um link só abre pelo domínio do workspace dono dele.
- Sem domínio salvo, os links continuam em `many.leadenginer.com`, como antes.
- **Remover** o domínio faz as próximas DMs saírem com `many.leadenginer.com`. Os links que já foram com o domínio continuam funcionando enquanto o DNS e o Dokploy continuarem apontando.

## O que você precisa fazer (uma vez)

Faça na ordem. Nada aqui foi feito pelo código.

### Passo 1. Deploy deste branch

1. Deploy de `feat/link-previa-curto` no **web** e no **worker** (mesma imagem). O start do web roda `prisma migrate deploy`, que aplica a migração `20261021120000_links_previa_curto` (só adiciona: três colunas opcionais em `TrackedLink`, uma em `Workspace`, a tabela `TrackedLinkRecipient` com RLS).
2. Se o log da migração mostrar o aviso "não deu pra dar as permissões de TrackedLinkRecipient", rode como superusuário do Postgres:
   ```sql
   GRANT SELECT ON public."TrackedLinkRecipient" TO le_app;
   GRANT SELECT, INSERT, UPDATE ON public."TrackedLinkRecipient" TO le_system;
   ```
   Sem isso o worker não salva o código e as DMs continuam saindo com o link antigo (`?c=`), que funciona.

### Passo 2. Cloudflare (zona cloudmatheus.com.br)

Hoje `comando.cloudmatheus.com.br` tem uma Redirect Rule que manda `/diag` pra `quiz.cloudmatheus.com.br/diag`. Ela continua.

1. **DNS**: o registro `comando` tem de apontar pro mesmo servidor do Lead Engine. O jeito mais simples é copiar o que o `quiz` usa: abra DNS > Records, veja o registro `quiz` (tipo A com o IP do servidor do Dokploy, ou CNAME) e deixe o `comando` igual, com a nuvem laranja (Proxied) do mesmo jeito que o `quiz`.
2. **Redirect Rule do /diag**: abra Rules > Redirect Rules e confira a regra do `comando`. Ela tem de valer **só** pro caminho `/diag`, assim:
   - Quando: `(http.host eq "comando.cloudmatheus.com.br" and http.request.uri.path eq "/diag")`
   - Então: redirecionamento pra `https://quiz.cloudmatheus.com.br/diag` (301 ou 302, como já está).

   Se a regra pegar o domínio inteiro (por exemplo "todas as requisições recebidas" ou uma Page Rule `comando.cloudmatheus.com.br/*`), os links `/r/...` também seriam desviados pro quiz. Nesse caso troque pelo filtro acima.
3. **Sem cache nos links**: Rules > Cache Rules > criar regra "Links do Lead Engine": quando `(http.host eq "comando.cloudmatheus.com.br" and starts_with(http.request.uri.path, "/r/"))`, então **Bypass cache**. O mesmo link responde uma coisa pro robô da prévia e outra pra pessoa.
4. **SSL/TLS**: use o mesmo modo que o `quiz` já usa (Full ou Full strict). Não mude a zona inteira.
5. **Robôs**: se a prévia não aparecer no WhatsApp ou no Instagram e você tiver "Bot Fight Mode" ou "Block AI bots" ligado, crie em Security > WAF > Custom rules uma regra **Skip** pra `(http.host eq "comando.cloudmatheus.com.br" and starts_with(http.request.uri.path, "/r/"))`. Os robôs da Meta precisam chegar no `/r/`.

### Passo 3. Dokploy

1. Aplicação **web** (não o worker) > Domains > Add Domain:
   - Host: `comando.cloudmatheus.com.br`
   - Path: `/`
   - Container port: `3000` (o mesmo do `many.leadenginer.com`)
   - HTTPS: ligado, certificado Let's Encrypt (igual ao domínio do quiz)
2. Salve e espere o certificado sair (uns minutos).
3. Variáveis: nada novo. **Não** coloque `comando.cloudmatheus.com.br` em `QUIZ_DOMAINS` (lá fica só o domínio do quiz). Se `QUIZ_DOMAINS` estiver vazio, também funciona: o Lead Engine sabe pelo banco que o `comando` é domínio de link.

### Passo 4. Conferir e ligar

1. No terminal, `curl -s https://comando.cloudmatheus.com.br/r/_ping` tem de responder `lead-engine-link-ok`.
2. `curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" https://comando.cloudmatheus.com.br/diag` tem de continuar mostrando `301` (ou `302`) pro quiz.
3. No Lead Engine: Canais > Conexões e chaves > Domínio dos links > digite `comando.cloudmatheus.com.br` > Salvar. Se der "ainda não chega no Lead Engine", volte aos passos 2 e 3.
4. No quiz do Chat Sem Frescura: coloque a imagem de compartilhamento (1200 x 630) e publique de novo.
5. Teste a prévia: `curl -s -A "facebookexternalhit/1.1" https://comando.cloudmatheus.com.br/r/<slug>` mostra as meta tags. Dá pra conferir também no Depurador de Compartilhamento da Meta (developers.facebook.com/tools/debug), que ainda força a Meta a ler de novo.
6. Mande uma DM de teste pra você mesmo e confira o link curto e o cartão.

O Instagram e o WhatsApp guardam a prévia de um link por um tempo. Links novos (DMs novas) já vêm com a prévia nova.

### Como voltar atrás

- Canais > Conexões e chaves > Domínio dos links > **Remover**. As próximas DMs saem com `many.leadenginer.com`. Mantenha o DNS e o domínio no Dokploy enquanto houver links com `comando` circulando.
- Voltar o código: redeploy do commit anterior no web e no worker. O banco pode ficar como está (o código antigo ignora as colunas e a tabela novas). Os links curtos (`/r/<slug>/<código>`) param de creditar a pessoa no código antigo, mas os `?c=` continuam.

## Rotas

| Método | Rota | O que faz |
| --- | --- | --- |
| GET, HEAD | `/r/<slug>` | link antigo (`?c=` opcional); robô e HEAD recebem a prévia |
| GET, HEAD | `/r/<slug>/<código>` | link curto; robô e HEAD recebem a prévia |
| GET | `/r/_ping` | responde `lead-engine-link-ok` (usado ao salvar o domínio) |
| GET, PUT | `/api/workspace/link-domain` | ler e salvar o domínio dos links (`{ "domain": "..." }`, `null` remove) |
| GET | `/api/links/preview-image` | o envio de arquivo está ligado neste servidor? |
| POST | `/api/links/preview-image/upload-url` | URL assinada pra enviar a imagem da prévia |

A API de campanhas (`/api/automations`) aceita `linkPreviewTitle` (até 120), `linkPreviewDescription` (até 300) e `linkPreviewImageUrl` (`https://`). Vazio ou `null` apaga; sem o campo, fica como está.

## Segurança

- `TrackedLinkRecipient` com RLS forçada: só o sistema (`le_system`, worker e rota `/r`) grava; membro do workspace ativo lê pelo `le_app`; o admin da plataforma lê.
- O código é sorteado (7 letras e números) e só vale junto com o slug do link. Não dá pra trocar o código pra creditar outra pessoa sem adivinhar um código que existe.
- Leitura da página de destino: só `https`, host público, cada IP conferido no DNS, redirecionamento conferido a cada salto, 256 KB no máximo.
- O domínio salvo precisa ser público, sem porta, sem IP, diferente do endereço do app e de nenhum outro workspace.

## Testes

- `__tests__/links-previa.test.ts`: quem é robô, capa do quiz (por slug, pelo domínio do quiz e pelo `comando.../diag`), campos do link vencem, página de destino, cache, SSRF, padrão neutro, HTML da prévia.
- `__tests__/links-curto-banco.test.ts` (PGlite, todas as migrações): migração aditiva e RLS, código curto, clique com contato e DM, `?c=` antigo, robô e HEAD sem clique, domínio do link só com `/r/*`, salvar o domínio.
- `__tests__/links-previa-api.test.ts`: campos da prévia na API de campanhas.
- `__tests__/quiz-share-meta.test.ts`: meta tags da página pública do quiz.
- `__tests__/dm-worker.test.ts` ("short link on the link domain"): o worker monta o link curto no texto e no botão, e cai no `?c=` se o código não salvar.
