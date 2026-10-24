# TikTok: revisão do app (Login Kit + Content Posting API)

Atualizado em 23/10/2026. O que o Lead Engine faz no TikTok: **conectar a conta (Login Kit) e publicar ou agendar vídeos (Content Posting API, Direct Post)**. Nada de comentários nem DM do TikTok (ver seção 5).

Os textos entre aspas em inglês são para colar no portal do TikTok for Developers.

## 1. Produtos e escopos

Adicionar ao app: **Login Kit** e **Content Posting API** (ligar **Direct Post**).

| Escopo | Para que serve no Lead Engine |
|---|---|
| `user.info.basic` | Mostrar o nome e a foto da conta conectada e identificar quem conectou (open ID). |
| `video.upload` | Enviar o arquivo do vídeo para o TikTok. |
| `video.publish` | Publicar o vídeo (Direct Post) na conta que a pessoa conectou. |

### Justificativas (inglês, para colar)

**Login Kit**
> Lead Engine is a web app for creators and businesses. A signed-in user clicks "Connect TikTok", logs in on TikTok's own page and approves the permissions. We use Login Kit only to identify the TikTok account the user wants to post to and to receive the tokens needed to publish. We never ask for the TikTok password and we do not use the data for any other purpose.

**Content Posting API (Direct Post)**
> Users upload a video in Lead Engine, write the caption and choose the privacy level, whether comments, duet and stitch are allowed, and whether the video promotes a brand (commercial content disclosure). The options shown come from the creator_info endpoint. After the user confirms, Lead Engine publishes the video to the user's own TikTok account now or at the scheduled time, and shows the publish status. Nothing is posted without an explicit confirmation by a person.

**user.info.basic**
> Used to show the connected account's display name and avatar in the app, so the user can see which TikTok account will receive the post. Not used for anything else.

**video.upload**
> Used to send the video file the user chose to TikTok (FILE_UPLOAD) before publishing.

**video.publish**
> Used to publish the video the user confirmed to the user's own TikTok account, with the privacy and interaction options the user selected.

## 2. Campos do app

| Campo | Valor |
|---|---|
| Nome | Lead Engine |
| Ícone | o logo do Lead Engine (1024x1024, sem logo do TikTok) |
| Categoria | Business / Productivity (a que o portal oferecer mais perto) |
| Descrição curta (inglês) | "Lead Engine helps creators and businesses manage their social conversations and publish or schedule videos to their own TikTok account." |
| Site | https://many.leadenginer.com |
| Termos | https://many.leadenginer.com/terms |
| Privacidade | https://many.leadenginer.com/privacy |
| Exclusão de dados | https://many.leadenginer.com/data-deletion |
| Redirect URI (Login Kit) | `https://many.leadenginer.com/api/tiktok/callback` (exata, sem barra no fim) |
| Variáveis no servidor | `TIKTOK_CLIENT_KEY` e `TIKTOK_CLIENT_SECRET` (nunca no código nem no GitHub) |

Termos e Privacidade já falam do TikTok (publicação, tokens cifrados, como revogar, exclusão).

### Verificação de URL prefix: por que não precisa agora

Ela só é exigida para **PULL_FROM_URL** (o TikTok baixa o vídeo de um endereço nosso). Nós usamos **FILE_UPLOAD** (enviamos o arquivo em partes), então não há domínio de mídia para verificar. Se o portal pedir mesmo assim:

1. No portal, abra o app, Manage URL properties, Add URL prefix e informe `https://many.leadenginer.com/`.
2. Escolha **meta tag** ou **arquivo de assinatura**. O TikTok mostra o valor.
3. Peça para colocar o arquivo em `public/` do repositório (ou a meta tag no `<head>` do layout), fazer Merge e Deploy do `openreply-web`.
4. Volte ao portal e clique em Verify.

## 3. Roteiro do vídeo demo (gravar em tela)

Gravar com a **conta de teste/sandbox**. App não auditado só publica como **Só eu** (SELF_ONLY): isso é esperado, diga no vídeo. Tela cheia do navegador, endereço visível, sem cortes entre as cenas.

| # | Na tela | Fala (inglês curto) |
|---|---|---|
| 1 | Home https://many.leadenginer.com, descer pelas redes conectadas e pelo bloco "Agende e publique vídeos" | "This is Lead Engine. It connects Instagram, Facebook, WhatsApp and TikTok. On TikTok it only connects the account and publishes or schedules videos." |
| 2 | Clicar em Entrar e fazer login | "I sign in to my Lead Engine account." |
| 3 | Abrir Posts e clicar em Conectar TikTok | "In Posts, I click Connect TikTok." |
| 4 | Tela de consentimento do TikTok, mostrando os escopos | "TikTok's own screen asks for the permissions: basic profile info, upload and publish. I never type my password in Lead Engine." Clicar em Autorizar. |
| 5 | Volta ao app com a conta conectada (nome e foto) | "I am back. The connected TikTok account appears with its name and picture." |
| 6 | Novo post, enviar o arquivo de vídeo | "I upload the video file." |
| 7 | Escrever a legenda | "I write the caption." |
| 8 | Abrir a privacidade: lista só com as opções do TikTok, nenhuma marcada | "Privacy options come from TikTok. There is no default: I must choose one. This app is not audited yet, so only 'Only me' is allowed." Escolher. |
| 9 | Comentários, Dueto e Stitch desligados por padrão | "Comments, duet and stitch start off. I can turn them on if TikTok allows it for my account." |
| 10 | Ligar a divulgação de conteúdo comercial, mostrar as opções (própria marca / marca de terceiros) e o aviso | "The commercial content toggle is off by default. If I turn it on, I pick what the video promotes and the declaration text appears." Depois desligar de novo. |
| 11 | Mostrar a declaração e o texto de consentimento antes do botão | "Before publishing I see TikTok's declaration and agree to it." Marcar. |
| 12 | Clicar em Publicar agora e confirmar | "I confirm. A person always confirms the post." |
| 13 | Status mudando (publicando, publicado) e abrir o TikTok mostrando o vídeo (Só eu) | "Status updates here, and the video appears on my TikTok account as Only me." |
| 14 | Opcional: agendar um post e mostrar na lista; depois Desconectar | "I can also schedule a post. And I can disconnect at any time, which deletes the tokens." |

## 4. Checklist da auditoria do Direct Post (regras de UX)

Conferir cada linha na tela /posts antes de gravar. A coluna "Onde" aponta o que olhar.

| Regra do TikTok | Onde na tela /posts |
|---|---|
| Mostrar o nome (nickname) da conta que vai receber o post | Linha "Postando como" no formulário e lista "Contas conectadas" |
| Opções de privacidade vêm só da consulta creator_info, sem opção padrão marcada | Campo "Escolha quem pode ver" (começa vazio, o botão Publicar agora fica travado até escolher) |
| Comentários, Dueto e Stitch desligados por padrão e desabilitados se o criador desativou no TikTok | Três chaves abaixo da privacidade |
| Divulgação de conteúdo comercial desligada por padrão | Chave "Divulgar conteúdo comercial" |
| Conteúdo de marca de terceiros não pode ser "Só eu" | Ao ligar a divulgação, a privacidade "Só eu" fica bloqueada com aviso |
| Declaração de uso de música e (se for o caso) de conteúdo de marca antes de publicar | Texto de consentimento acima do botão Publicar |
| O usuário vê e edita a legenda e confirma antes de enviar; nada é publicado sozinho | Botão "Sim, publicar agora" |
| Mostrar o status da publicação | Lista de posts (publicando, publicado, falhou, com o motivo) |
| Limites do vídeo (duração e tamanho) vindos da consulta, avisados antes do envio | Aviso no envio do arquivo |

Se alguma linha não bater com a tela entregue, corrigir a tela antes do vídeo.

## 5. Comentários e DM do TikTok: a verdade

- **Não existe API pública** para responder comentários nem para DM de criador no TikTok. Por isso a home, a Privacidade e os Termos **não prometem** isso.
- O caminho possível seria TikTok for Business (Business Messaging), com **pedido de acesso separado**, e não faz parte desta revisão.
- Primeiro passo é só publicar. Depois da aprovação, o app deixa de ficar preso a "Só eu" (precisa passar a auditoria do Direct Post).
- **Postiz** (github.com/gitroomhq/postiz-app) é AGPL-3.0. **Não copiamos código dele**: a integração é nossa, escrita a partir da documentação pública do TikTok. O Postiz serviu só de referência do formato das chamadas.
