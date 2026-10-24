# Agendar em várias redes (aba Posts)

A aba Posts agenda e publica vídeo em **TikTok, YouTube, Instagram (Reels) e Página do Facebook**. TikTok segue como antes (`docs/tiktok-revisao.md`).

## Como funciona

- Cada rede é um provider em `lib/social/providers/`. Todos usam o mesmo fluxo: rascunho, agendado, publicando, publicado ou falhou.
- `/api/cron/social-publish` (chamado pelo `scripts/cron.sh`) varre o que venceu e confere o que ficou esperando a rede (Instagram). `/api/cron/tiktok-publish` continua existindo como apelido.
- YouTube e TikTok ficam em `SocialAccount`. Instagram e Facebook usam as contas que já estão em `InstagramAccount` (o mesmo token da aba Canais).
- MCP e chave de API só leem e criam RASCUNHO. Agendar, publicar, cancelar, apagar e enviar arquivo é só pela tela.

## Variáveis novas

| Variável | Para quê |
|---|---|
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | Opcionais. Sem elas vale `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` (o mesmo app do login). |
| `YOUTUBE_OAUTH_SCOPES` | Opcional. Troca a lista de permissões (separada por vírgula ou espaço). Padrão: `youtube.upload`, `youtube.readonly`, `youtube.force-ssl` e `youtube`. |
| `INSTAGRAM_PUBLISH_ENABLED=1` | Liga o escopo `instagram_business_content_publish` na conexão do Instagram. |
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

- Instagram: permissão `instagram_business_content_publish` (precisa de revisão do app) e `INSTAGRAM_PUBLISH_ENABLED=1`. Depois, reconectar a conta.
- Facebook: permissão `pages_manage_posts` e `FACEBOOK_PUBLISH_ENABLED=1`. Depois, reconectar a Página.
- Sem a permissão, a publicação falha com a mensagem para reconectar.

## Limites por rede

| Rede | Legenda ou descrição | Vídeo |
|---|---|---|
| TikTok | 2200 | mp4, mov, webm, até 1 GB |
| YouTube | título 100, descrição 5000 | mp4, mov, webm, até 2 GB. Declarar "feito para crianças" (sem padrão) e conteúdo com IA |
| Instagram (Reels) | 2200 | mp4, mov, até 300 MB. A Meta processa e o cron confere até ficar pronto |
| Facebook (Página) | título 255, descrição 5000 | mp4, mov, até 1 GB |

## Outros pontos

- Migração aditiva `20261028120000_social_multi_rede`: `ScheduledPost.socialAccountId` vira opcional e entra `channelId` (conta Instagram/Facebook). Faça backup antes (`pg_dump`).
- Desconectar um canal mantém os dados. Só o dono apaga de verdade.
- Comentários do YouTube não estão neste PR. Existe o ajudante `youtubeFetch(account, path)` (com renovação do token) para o próximo.
