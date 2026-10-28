# TikTok via Zernio

O app de TikTok do Lead Engine não foi auditado pelo TikTok: em produção só publica "Só eu" em conta privada. A Zernio (zernio.com) conecta o TikTok pelo app deles e publica vídeo **público** (ou manda **rascunho** para o app). Este modo troca só o caminho de publicação do TikTok; YouTube, Instagram e Facebook não mudam.

## Variáveis de ambiente (só no servidor)

| Variável | Para que serve |
|---|---|
| `TIKTOK_VIA_ZERNIO=1` | Liga o modo. Sem ela, tudo continua como antes. |
| `ZERNIO_API_KEY` | Chave da API da Zernio. Nunca no código, no log nem no navegador. |
| `ZERNIO_TIKTOK_ACCOUNT_ID` | `accountId` da conta TikTok na Zernio (`GET /accounts`). Conta do Matheus: `6ae0f0d1f4ab38f6b78845ca` (omatheus.ai). |
| `ZERNIO_OWNER_WORKSPACE_ID` | Id do workspace do dono. A conta única acima só vale para ele; sem esta variável nenhum workspace usa a conta única (falha fechado). Outros workspaces precisam de `ZERNIO_TIKTOK_ACCOUNT_MAP`. |
| `ZERNIO_TIKTOK_ACCOUNT_MAP` | Opcional, para mais de uma conta: JSON `{"<id da SocialAccount ou username>": "<accountId da Zernio>"}`. Tem prioridade sobre a variável acima. |
| `ZERNIO_FORCE_PRESIGN=1` | Opcional. Sempre envia o vídeo para a Zernio por upload (`/media/presign`) em vez de passar a URL. Sem ela, o provider passa a URL do nosso armazenamento e só usa o upload se a Zernio recusar a URL. |

## Como mapear a conta

O post continua apontando para uma conta de TikTok do Lead Engine (a `SocialAccount`, que precisa existir e não estar desconectada). O provider troca essa conta pelo `accountId` da Zernio usando as variáveis acima. Não há migração de banco.

## Ligar e desligar

1. Defina as variáveis e `TIKTOK_VIA_ZERNIO=1`, e reinicie/redeploy.
2. Na aba Posts, a privacidade do TikTok vira **Público** ou **Rascunho no app do TikTok**; conteúdo comercial some.

**Rollback:** remova `TIKTOK_VIA_ZERNIO` (ou ponha `0`) e reinicie. O TikTok volta ao app próprio. Posts já enviados à Zernio e ainda "publicando" ficam sem conferência pelo caminho antigo; confira-os no app do TikTok.

## Como funciona

- Publicar cria o post na Zernio (`POST /posts`, `publishNow`) e guarda o id da Zernio como `publishId` na hora. O cron `social-publish` (já existente) consulta `GET /posts/{id}` até `published` ou `failed`.
- Idempotência: com `publishId` salvo, uma nova tentativa só cria outro post se o anterior tiver **falhado** na Zernio. A Zernio também responde 409 se o mesmo conteúdo foi postado na mesma conta nas últimas 24 h; isso vira erro claro, sem reenviar.
- "Rascunho no app" é o `privacyLevel: SELF_ONLY` gravado no post (rascunhos criados por MCP/API nascem assim, então nunca saem públicos sozinhos).

## Limites conhecidos

- Vídeo só **público** ou **rascunho** (outras privacidades são recusadas pela Zernio com 400).
- No rascunho a **legenda não chega** ao app do TikTok.
- Sem conteúdo comercial/marca neste modo.
- TikTok: 15 vídeos por dia (janela de 24 h); acima disso a Zernio segura o post e publica quando liberar.
- Só MP4 e MOV (WebM não), até 1 GB no Lead Engine.
- O TikTok leva de segundos a poucos minutos para processar; o cron roda a cada 5 minutos.
- Ainda não foi rodado contra a Zernio real por este código: ver o teste manual no relatório da entrega.
