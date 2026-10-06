# WhatsApp pela uazapi (ramo feat/wa-uazapi)

Segundo provedor de WhatsApp do Lead Engine, ao lado do OpenWA. Cada número (WaSession) escolhe o seu pelo campo `provider` (`OPENWA` ou `UAZAPI`; o que já existia continua `OPENWA`, que também virou o padrão da coluna).

## Por que

O número pessoal do dono foi bloqueado 5 segundos depois de conectar pelo OpenWA (whatsapp-web.js num IP de datacenter). A uazapi também não é oficial (QR ou código de pareamento), mas tem proxy gerenciado por país e cidade: a sessão sai por um IP do Brasil. A API oficial (Cloud API) entra depois da aprovação da Meta e não faz parte deste ramo.

## Variáveis novas (só no servidor)

| Variável | Uso |
|---|---|
| `UAZAPI_SERVER_URL` | Endereço do servidor da uazapi (ex.: `https://<sub>.uazapi.com`) |
| `UAZAPI_ADMIN_TOKEN` | admintoken: cria e lista instâncias. Nunca vai pro navegador nem pro worker de envio |
| `UAZAPI_MAX_INSTANCES` | Opcional. Dispositivos do plano (padrão 2). A uazapi não informa o tamanho do plano |

Desde 06/10/2026 o dono também pode colar a Server URL, o Admin token e os dispositivos em Canais > Conexões e chaves (vale antes destas variáveis, ver docs/canais-chaves.md). Sem nada salvo lá e sem `UAZAPI_SERVER_URL` e `UAZAPI_ADMIN_TOKEN`, a opção uazapi aparece desabilitada na tela, com a explicação. Nada mais muda. O worker (`worker/wa-worker.ts`) também precisa de `UAZAPI_SERVER_URL` pra enviar.

## Migração

`prisma/migrations/20261016120000_wa_uazapi`: só aditiva.

- `whatsapp."WaProvider"` ganha `UAZAPI`;
- `WaSession.provider` com padrão `OPENWA`;
- `WaSession.instanceTokenEnc` (token da instância, AES-256-GCM com `ENCRYPTION_KEY`, igual ao `webhookSecretEnc`), `proxyCountry`, `proxyState`, `proxyCity`, `proxyCityLabel`, todas opcionais;
- RLS da Fase 0 (já forçada em `WaSession`) reafirmada.

## Fluxo na tela Conexões

1. "Conectar número": a pessoa escolhe o provedor. uazapi em destaque ("recomendado: sai por IP do Brasil"), com as vagas livres do plano. OpenWA com aviso forte ("risco alto: só chip de teste").
2. uazapi: país e cidade vêm das listas da própria uazapi (`/proxy-managed/countries` e `/proxy-managed/cities`), Brasil já escolhido. Sem cidade, não conecta (o servidor também confere a cidade na lista da uazapi; o estado e o nome vêm de lá, não do navegador).
3. QR code ou código de pareamento (pede o número com país e DDD).
4. Mesmo termo de risco e a caixinha "é um número só pra isso, nunca o pessoal".
5. O servidor cria a instância (`POST /instance/create` com a região), guarda token e segredo só cifrados, registra o webhook e chama `POST /instance/connect` com a região de novo. Depois confere `GET /instance/proxy`: se a uazapi disser que está saindo `direct` (sem proxy), a tela mostra um alerta vermelho.
6. Número conectado: botão "Reiniciar conexão" (`POST /instance/reset`, sem novo QR). Número desconectado: "Conectar de novo" (QR ou código, na mesma instância e na mesma cidade).
7. Desconectar: `POST /instance/disconnect`. Nada é apagado no Lead Engine e a instância continua na uazapi (o Desconectar nunca chama `DELETE /instance`). Por isso o número desconectado continua ocupando a vaga dele no plano: reconecte em vez de criar outro.
8. Excluir número (botão separado, só dono ou admin, com confirmação): `POST /instance/disconnect` e `DELETE /instance`, que libera o dispositivo do plano. Duas opções: "Excluir só o número" (o número some de Conexões; conversas, contatos e mensagens ficam guardados, só leitura em Conversas) ou "Excluir número e conversas" (apaga também conversas, mensagens, mídias, eventos do webhook e memória e rascunhos do agente daquele número; pede o nome digitado). Se a uazapi não responder, o número sai do Lead Engine do mesmo jeito e a tela mostra o id da instância pra conferir no painel da uazapi. Cada exclusão fica registrada em `whatsapp."WaNumberDeletion"` (quem, quando, qual opção, sem conteúdo). O OpenWA faz o mesmo com `POST /api/sessions/:id/logout` e `DELETE /api/sessions/:id`.

## Webhook e validação da origem

URL registrada em cada instância (modo simples do `POST /webhook`): `https://<app>/api/whatsapp/webhook/uazapi/<WaSession.id>/<segredo>`.

A uazapi não assina o corpo (não tem HMAC). A origem é conferida assim:

1. **Segredo na URL**, um por número, 32 bytes aleatórios, guardado só cifrado (`webhookSecretEnc`). Comparado em tempo constante (HMAC dos dois lados + `timingSafeEqual`). Errado, sessão desconhecida ou número de outro provedor: 401 e nada gravado (mesma resposta pros três).
2. **Token da instância no corpo**: a uazapi manda o `token` da instância em todo evento. Se vier e não bater com o token guardado (tempo constante): 401.
3. Corpo até 2 MB, 600 requisições por minuto por IP, igual ao webhook do OpenWA.

O evento cru não é gravado (ele traz o token). O `WaWebhookEvent` guarda só o evento normalizado. Idempotência: `uazapi:<instância>:msg:<messageid>`, `...:ack:<id>:<estado>` e `...:conn:<event_id>`.

Eventos assinados: `messages`, `messages_update`, `connection`. Filtro `excludeMessages: ["wasSentByApi"]`: o que o Lead Engine envia já fica gravado na hora; se o eco vier mesmo assim, é descartado (não vira "o dono respondeu pelo celular").

- `messages`: texto e mídia (imagem, vídeo, áudio, documento, figurinha). Mídia: o inbox busca na hora por `POST /message/download` (fileURL, vale 2 dias), no servidor.
- `messages_update`: entrega e leitura (`Delivered`, `Read`, `Played`) das mensagens enviadas. Recibo de grupo (`GroupReceipts`) fica de fora. O ack nunca volta (read não vira delivered).
- `connection`: status do número; `TemporaryBan` vira `RESTRICTED`.

## Histórico antigo NÃO é importado

A uazapi manda o histórico ao conectar (evento `history`). O Lead Engine não importa: só mensagens novas a partir da conexão (privacidade e volume). Três travas:

1. `history` não está na lista de eventos do webhook;
2. se chegar mesmo assim, o webhook responde 200 e não grava nada (nem o evento cru);
3. `POST /message/history-sync` nunca é chamado.

## Envio

Mesmo caminho do OpenWA (`lib/whatsapp/outbound.ts`): regra das 24h, "Assumir", bolhas com tempo de leitura e "digitando..." (`POST /message/presence` composing/paused), 12 por minuto por número. O campo `delay` da uazapi não é usado (o ritmo é nosso).

A uazapi não tem chave de idempotência (`track_id` aceita repetido). Então envio com tempo esgotado ou 5xx não é repetido pela fila (`UnrecoverableError` no worker, só pra uazapi): melhor uma bolha a menos do que a mesma bolha duas vezes. 429 continua tentando de novo. O `track_id` leva `<outboxId>:<bolha>` pra achar o envio depois.

## Rotas da uazapi usadas

`GET /proxy-managed/countries`, `GET /proxy-managed/cities`, `GET /instance/all` (admintoken, vagas), `POST /instance/create` (admintoken), `POST /instance/connect`, `GET /instance/status`, `GET /instance/proxy`, `POST /instance/disconnect`, `POST /instance/reset`, `DELETE /instance` (só no Excluir número), `POST /webhook`, `POST /send/text`, `POST /send/media`, `POST /message/presence`, `POST /message/markread`, `POST /chat/read`, `POST /message/download`.

## Rotas novas do Lead Engine

- `POST /api/whatsapp/webhook/uazapi/[sessionId]/[secret]` (webhook)
- `GET /api/whatsapp/uazapi` (configurada? vagas)
- `GET /api/whatsapp/uazapi/regions?country=br&search=` (países e cidades)
- `POST /api/whatsapp/sessions/[id]/restart` (reiniciar)
- `POST /api/whatsapp/sessions` e `POST /api/whatsapp/sessions/[id]/connect` aceitam `provider`, `method` (`qr` | `code`), `phone` e `proxy: { country, city }`

## O que a documentação não deixou claro (conferir no teste real)

- O servidor do dono está na 2.4.2 e a documentação na 2.4.4. Se `/proxy-managed/*` não existir nessa versão, a tela avisa ("este servidor da uazapi não tem a lista de cidades") e não conecta. Se `POST /instance/create` recusar os campos `proxy_managed_*` (400), a tela pede outra cidade.
- Se o `token` vem em todo evento da 2.4.2. Se não vier, só o segredo da URL protege (continua seguro; o segredo tem 256 bits).
- O formato exato de `message.content` na mídia (mimetype e nome do arquivo) varia por tipo; o código lê `mimetype`/`mimeType` e `fileName`/`title`.
- A uazapi não reentrega webhook que falhou. Se a fila (Redis) cair na hora, o webhook responde 500 e o evento se perde (falta uma reconciliação por `POST /message/find`).
- `GET /instance/all` conta todas as instâncias do servidor (inclusive criadas no painel da uazapi). Se ela falhar, a conta cai pros números uazapi do Lead Engine.
- Liberar uma vaga do plano exige apagar a instância (`DELETE /instance`). O Desconectar não faz isso (regra "desconectar não apaga nada"); quem faz é o botão separado "Excluir número", com confirmação.
