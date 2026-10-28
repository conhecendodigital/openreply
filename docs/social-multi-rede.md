# Agendar em várias redes (aba Posts)

A aba Posts agenda e publica vídeo em **TikTok, YouTube, Instagram (Reels e carrossel) e Página do Facebook**. TikTok segue como antes (`docs/tiktok-revisao.md`).

## Como funciona

- Cada rede é um provider em `lib/social/providers/`. Todos usam o mesmo fluxo: rascunho, agendado, publicando, publicado ou falhou.
- `/api/cron/social-publish` (chamado pelo `scripts/cron.sh`) varre o que venceu e confere o que ficou esperando a rede (Instagram). `/api/cron/tiktok-publish` continua existindo como apelido.
- YouTube e TikTok ficam em `SocialAccount`. Instagram e Facebook usam as contas que já estão em `InstagramAccount` (o mesmo token da aba Canais).
- MCP e chave de API leem, enviam mídia (link de PUT), criam RASCUNHO e, a pedido do dono, agendam e publicam um post que já existe (seção "MCP: enviar mídia, agendar e publicar" abaixo). Cancelar, apagar e a declaração "feito para crianças" do YouTube são só pela tela.

## Variáveis novas

| Variável | Para quê |
|---|---|
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | Opcionais. Sem elas vale `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` (o mesmo app do login). |
| `YOUTUBE_OAUTH_SCOPES` | Opcional. Troca a lista de permissões (separada por vírgula ou espaço). Padrão: `youtube.upload`, `youtube.readonly`, `youtube.force-ssl` e `youtube`. |
| `INSTAGRAM_PUBLISH_DISABLED=1` | Interruptor de emergência (27/10/2026). Por padrão o login do Instagram já pede `instagram_business_content_publish`; com `=1` volta ao pedido antigo, sem publicar. `INSTAGRAM_PUBLISH_ENABLED=0` (nome antigo) também desliga; `=1` não faz mais diferença. |
| `FACEBOOK_PUBLISH_ENABLED=1` | Liga o escopo `pages_manage_posts` na conexão do Facebook. |

## Google Cloud (YouTube)

1. No mesmo projeto do login, ative a **YouTube Data API v3**.
2. Na tela de consentimento OAuth, adicione os escopos `youtube.upload`, `youtube.readonly`, `youtube.force-ssl` e `youtube`.
3. No cliente OAuth, em URIs de redirecionamento, adicione exatamente `https://many.leadenginer.com/api/youtube/callback` (a base é o `getBaseUrl()` do servidor; troque se o domínio mudar).
4. Reconecte o canal em Canais, Conectar canal, YouTube. O Google devolve o refresh token por causa do `prompt=consent`.

Modo de teste e verificação:

- O `youtube.force-ssl` é escopo sensível. App **sem verificação** funciona na sua conta como usuário de teste (até 100 usuários de teste, com o aviso de app não verificado). Terceiros só entram depois da verificação do Google.
- Enquanto o app não for verificado, o YouTube deixa todo vídeo enviado como **Privado**. A tela avisa.
- Cota: cada upload gasta 1600 das 10.000 unidades diárias, perto de 6 vídeos por dia.
- Se a pessoa desmarcar permissões na tela do Google, a conexão vale mesmo assim e o canal mostra o que falta.

## Meta (Instagram e Facebook)

### Permissões do login do Instagram (Instagram Login)

O botão "Conectar Instagram" pede, por padrão, estas cinco permissões:

| Permissão | Para quê | Na documentação da Meta |
|---|---|---|
| `instagram_business_basic` | perfil e mídia | confirmada |
| `instagram_business_manage_messages` | Direct | confirmada |
| `instagram_business_manage_comments` | comentários | confirmada |
| `instagram_business_content_publish` | publicar Reels e carrossel | confirmada |
| `instagram_business_manage_insights` | métricas | já era pedida antes; as páginas consultadas em 27/10/2026 não a listam |

Fontes: developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login, .../content-publishing e developers.facebook.com/docs/permissions.

Se a tela da Meta não mostrar "publicar" ao conectar, a causa mais provável é o app: a permissão precisa estar adicionada ao caso de uso do app em Meta for Developers (e, para outras contas além das suas, passar na revisão do app). Pedir uma permissão que o app não tem pode fazer a tela de autorização falhar inteira. Se isso acontecer, ponha `INSTAGRAM_PUBLISH_DISABLED=1` no Dokploy e redeploy: o login volta a pedir só as quatro de antes.

### Painel "Permissões autorizadas"

Em Canais, no detalhe do Instagram, cada permissão aparece como Ativa, Faltando ou Não confirmada. A documentação consultada não traz um endpoint para ler as permissões de um token. O único registro documentado é o campo `permissions` da resposta que a Meta dá ao trocar o código pelo token, então guardamos esse campo na conexão (`InstagramAccount.grantedScopes`, migração `20261029120000_instagram_granted_scopes`, aditiva). O painel mostra "concedidas na última conexão", não uma leitura ao vivo. Conta conectada antes disso aparece como "Não confirmada" até reconectar.

### Carrossel

- Escolha "Carrossel" nas opções do Instagram (só com o Instagram marcado sozinho). Dá para escolher várias imagens, reordenar e remover. O mínimo é 2 e o máximo é 20 (limite da documentação da Meta). Tamanho recomendado: 1080x1350 (4:5); a tela avisa se o slide for diferente e se o formato for diferente do primeiro (a Meta corta todos pelo formato do primeiro).
- A Meta só aceita JPEG. PNG enviado na tela é convertido para JPEG (sharp, qualidade 92, sem redimensionar, transparência vira fundo branco) na hora de publicar e guardado de novo na pasta do workspace.
- Como é guardado: `ScheduledPost.settings = { shareToFeed, format: "CAROUSEL", slides: [{ url, bytes, contentType, width, height }] }`. `mediaUrl`, `mediaBytes` e `mediaContentType` do post são os do 1º slide. Sem mudança de tabela; Reels antigos seguem iguais (sem `format`).
- Publicação: um container filho por imagem (`is_carousel_item=true`), espera cada filho ficar FINISHED, container pai `media_type=CAROUSEL` com `children` na ordem dos slides e, no cron, confere o pai e só então chama `media_publish`. Erro em um filho para tudo e diz qual slide.
- Limite diário pela API: a documentação mostra dois números (50 e 100 posts em 24 horas) e diz que carrossel conta como um post. Não bloqueamos por contagem: o endpoint `content_publishing_limit` da Meta é a fonte.

### Reel de teste

Opção no Reel: "Reel de teste" (só para quem não segue). Manda `trial_params={"graduation_strategy":"MANUAL"|"SS_PERFORMANCE"}` no container do Reel. A documentação mostra o parâmetro em JSON; o código manda o JSON como texto no campo. Desligado por padrão. Ainda não foi testado contra a Meta real.

### Facebook

- Facebook: permissão `pages_manage_posts` e `FACEBOOK_PUBLISH_ENABLED=1`. Depois, reconectar a Página.
- Sem a permissão, a publicação falha com a mensagem para reconectar.

## Limites por rede

| Rede | Legenda ou descrição | Vídeo |
|---|---|---|
| TikTok | 2200 | mp4, mov, webm, até 1 GB |
| YouTube | título 100, descrição 5000 | mp4, mov, webm, até 2 GB. Declarar "feito para crianças" (sem padrão) e conteúdo com IA |
| Instagram (Reels) | 2200 | mp4, mov, até 300 MB. A Meta processa e o cron confere até ficar pronto |
| Instagram (carrossel) | 2200 | 2 a 20 imagens JPEG ou PNG, até 8 MB cada (limite nosso). PNG vira JPEG ao publicar |
| Facebook (Página) | título 255, descrição 5000 | mp4, mov, até 1 GB |

## Outros pontos

- Migração aditiva `20261028120000_social_multi_rede`: `ScheduledPost.socialAccountId` vira opcional e entra `channelId` (conta Instagram/Facebook). Faça backup antes (`pg_dump`).
- Desconectar um canal mantém os dados. Só o dono apaga de verdade.
- Comentários do YouTube não estão neste PR. Existe o ajudante `youtubeFetch(account, path)` (com renovação do token) para o próximo.

## MCP: enviar mídia, agendar e publicar (27/10/2026)

Fluxo: o Claude sobe o arquivo, cria o rascunho, e o dono revisa na tela ou manda agendar/publicar na conversa.

1. `enviar_midia_post` {nome, contentType, bytes}: devolve `uploadUrl` (vale 15 min) e o `mediaUrl` final, em `<workspace>/posts/<mês>/<uuid>.<ext>`. O Claude faz o envio: `curl -X PUT -H "Content-Type: <contentType>" --upload-file <arquivo> "<uploadUrl>"`. Vídeo mp4/mov/webm (até 2 GB, cada rede confere o seu limite ao criar o rascunho) e imagem jpeg/png (até 8 MB). Máximo de 30 links por hora por chave (sem o contador, não gera link). Cada pedido vira um `OperationalEvent` (chave, nome, tamanho, tipo; nunca o conteúdo). Rota: `/api/mcp-media/upload-url` (só chave; pessoa logada leva 403). A rota da tela `/api/posts/upload-url` continua só da pessoa logada.
2. `criar_rascunho_post` com o `mediaUrl` devolvido. Carrossel do Instagram: um envio por slide e `settings: {shareToFeed: true, format: "CAROUSEL", slides: [{url, bytes, contentType}]}` (mediaUrl/bytes/tipo do post = 1º slide). Os slides também têm que estar na pasta de posts do workspace. Nasce sempre RASCUNHO, sem horário. YouTube: a declaração "feito para crianças" fica em branco de propósito e `agendar_post`/`publicar_post` devolvem o que falta.
3. `agendar_post` {postId, scheduledAt ISO com fuso} e `publicar_post` {postId}: usadas só quando o dono pede. Reaproveitam a mesma regra da tela (`lib/social/post-actions.ts`: readyProblem, claimPost, lock). Só agem em post existente do workspace da chave, em RASCUNHO ou AGENDADO. Repetir o pedido não duplica. Nunca criam nem apagam. A resposta é lida do banco depois da ação: id, rede, estado, horário de Brasília com dia da semana, legenda curta e `conferencia` ("CONFERE" ou "NÃO CONFERE"). Cada ação vira um `OperationalEvent` (chave, postId, rede, horário; sem legenda nem arquivo). Rotas: `/api/mcp-publish/[id]/schedule` e `/publish`. As da tela (`/api/posts/[id]/schedule` e `/publish`) seguem só da pessoa logada.

Não há notificação ao dono (Telegram/WhatsApp) neste PR: só o registro.

### Rollback

- Parar de agendar/publicar pelo MCP sem novo deploy: defina `MCP_PUBLISH_DISABLED=1` no servidor e reinicie. As duas ferramentas respondem que estão desligadas.
- Remover tudo: reverter o commit (nenhuma migração de banco). Sem o commit, o MCP volta a só criar rascunho com mídia enviada pela tela.
- Arquivos já enviados ficam no armazenamento; apagar é manual (pasta `<workspace>/posts/`).
