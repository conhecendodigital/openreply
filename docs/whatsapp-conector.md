# Conector de WhatsApp (branch feat/wa-conector)

Parte do plano "Inbox de WhatsApp + Lead Engine multiusuário". Este branch entrega o conector: os dois adaptadores, o webhook, a ingestão e a fila de saída. Não tem tela e não liga nada em produção: o webhook responde 503 até a Fase 0 registrar o repositório.

## O que tem aqui

| Arquivo | O que faz |
|---|---|
| `lib/whatsapp/types.ts` | Tipos próprios com os nomes do schema `whatsapp` do plano (WaSession, WaContact, WaConversation, WaMessage, enums WaProvider, WaStatus, AgentMode, SentBy) |
| `lib/whatsapp/connector.ts` | Interface `WhatsAppConnector` (conectar, QR, status, enviar texto, mídia e template, "digitando...", marcar lida, desconectar) |
| `lib/whatsapp/openwa.ts` | Adaptador do gateway OpenWA (API REST com `X-API-Key`, `Idempotency-Key` nos envios). Não conecta sem `riskAcceptedAt` (termo de risco) |
| `lib/whatsapp/cloud-api.ts` | Adaptador da Cloud API oficial + `completeCoexistenceOnboarding` (token, `subscribed_apps`, `smb_app_data` de contatos e histórico) |
| `lib/whatsapp/factory.ts` | `createConnector(session, credenciais)`: escolhe o adaptador pelo `provider` do número |
| `lib/whatsapp/signature.ts` | HMAC-SHA256 em tempo constante (OpenWA e Meta) |
| `lib/whatsapp/normalize.ts` | Webhook do OpenWA e da Meta (`messages`, `smb_message_echoes`, `history`) para um formato só |
| `lib/whatsapp/webhook.ts` | Núcleo do `POST /api/whatsapp/webhook`: tamanho, limite por IP, assinatura, janela de tempo, idempotência, fila |
| `app/api/whatsapp/webhook/route.ts` | A rota (GET = verificação da Meta, POST = eventos). Fora de `lib/api-key-routes.ts` |
| `lib/whatsapp/repository.ts` | Interface `WaRepository` + `InMemoryWaRepository` (testes) |
| `lib/whatsapp/ingest.ts` | Job `wa-ingest`: grava contato, conversa e mensagem; ack nunca volta |
| `lib/whatsapp/pacing.ts` | Regra das 24h, quebra em bolhas, tempos de leitura e "digitando...", limite por minuto por número |
| `lib/whatsapp/outbound.ts` | `enqueueOutbound` e `processSendJob` (fila `wa-send`) |
| `lib/whatsapp/queue.ts` / `worker.ts` / `worker/wa-worker.ts` | Filas BullMQ e o worker separado (`tsx worker/wa-worker.ts`) |
| `lib/whatsapp/runtime.ts` | Onde a Fase 0 liga o repositório real |
| `prisma/migrations-wa/0001_conector/migration.sql` | Campos e tabela extras que o conector precisa (abaixo) |

## Regras que o código garante

- **Assinatura:** OpenWA assina com o segredo do número (`X-OpenWA-Signature`). Meta assina com o segredo do app (`X-Hub-Signature-256`, aceita `WHATSAPP_APP_SECRET` e `FACEBOOK_APP_SECRET`). Assinatura errada responde 401 e não grava nada. Sessão desconhecida responde igual.
- **Replay:** no OpenWA, o `timestamp` e o `idempotencyKey` estão dentro do corpo assinado. Evento com mais de 6 h ou mais de 5 min no futuro é recusado. O cabeçalho `X-OpenWA-Idempotency-Key` é ignorado de propósito (não é assinado). Na Meta, a idempotência é pelo `wamid`.
- **Idempotência:** `WaWebhookEvent.dedupeKey` é a trava. Se a fila cair, o webhook responde 500, o provedor reentrega e o evento que ficou sem `queued` entra na fila nessa nova tentativa. O `jobId` fixo evita job duplo.
- **Limites:** corpo até 2 MB (lido aos pedaços, para no limite) e 600 requisições por minuto por IP (Redis, igual `lib/http-rate-limit.ts`).
- **Regra das 24h (dois conectores, inclusive template):** só envia se a última mensagem do CONTATO tiver menos de 24 h. Conferida ao enfileirar e de novo antes de cada bolha. Fora disso o envio é barrado e registrado (`recordBlockedSend`).
- **"Assumir":** mensagem com `sentBy = AGENT` não sai enquanto `WaConversation.humanTakeoverUntil` estiver no futuro. Quem manda pelo app (`USER_APP`) continua.
- **Ritmo humano:** cada parágrafo vira uma bolha; parágrafo longo quebra por frase (até 220 caracteres, até 5 bolhas, nada some). Antes da primeira bolha espera 1,5 a 4 s ("lendo"), liga o "digitando..." por 60 ms por caractere com variação de -20% a +25% (entre 1,2 s e 9 s), envia, pausa 0,4 a 1,2 s e segue. Limite de 12 mensagens por minuto por número: passou disso, o job volta pra fila no minuto seguinte, a partir da bolha que faltou.
- **Retentativa não repete bolha:** o progresso fica no job (`nextIndex`) e cada bolha leva `Idempotency-Key = <outboxId>:<índice>` no OpenWA.

## Variáveis de ambiente

| Variável | Uso |
|---|---|
| `WHATSAPP_ENABLED=1` | Liga o webhook e o worker (sem isso, 503 e o worker sai) |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | `hub.verify_token` da Meta no GET |
| `WHATSAPP_APP_SECRET` | Segredo do app Meta do WhatsApp (se for o mesmo app do Instagram, `FACEBOOK_APP_SECRET` já serve) |
| `OPENWA_BASE_URL`, `OPENWA_API_KEY` | Gateway OpenWA, só no servidor |
| `META_GRAPH_API_VERSION` | Já existe (padrão `v25.0`) |

## Encaixe com a Fase 0 (o que mudar quando juntar)

1. **Schema Prisma.** Os nomes de `types.ts` são os do plano. Ao juntar:
   - `WaSession` ganha `wabaId String?` e `accessTokenEnc String?` (token de negócio da Cloud API, cifrado).
   - Índice `WaMessage(conversationId, sentBy, sentAt desc)` pra regra das 24h.
   - Tabela `WaSendBlock` (envios barrados) com RLS `owner_or_admin`.
   - Tudo isso está em `prisma/migrations-wa/0001_conector/migration.sql`. Passe para o `schema.prisma` e gere a migração normal; depois apague a pasta `migrations-wa`.
2. **Repositório Prisma.** Criar `lib/whatsapp/prisma-repository.ts` implementando `WaRepository`:

   | Método | Tabela / regra |
   |---|---|
   | `findSessionByProvider` | `app.resolve_wa_session(providerSessionId)` com `prismaSystem` (webhook ainda não sabe o dono), conferindo `provider`; decifra `webhookSecretEnc` |
   | `getSession` | `WaSession` por id (decifra `webhookSecretEnc`) |
   | `recordWebhookEvent` / `markWebhookEventQueued` | `WaWebhookEvent` (`create` com `dedupeKey`; P2002 = duplicado, devolve `status === "queued"`) e `update status = "queued"` |
   | `updateSessionStatus` | `WaSession.status`, `phoneE164`, `lastEventAt`, `connectedAt` quando virar CONNECTED |
   | `upsertContact` | `WaContact` `upsert` por `@@unique([sessionId, jid])` |
   | `upsertConversation` | `WaConversation` `upsert` por `@@unique([sessionId, contactId])` |
   | `insertMessage` | `WaMessage` `create`; P2002 em `[sessionId, providerMessageId]` = já existe (não troca `sentBy`, exceto USER_PHONE → AGENT/USER_APP quando o eco do OpenWA chegou antes do envio gravar) |
   | `touchConversation` | `lastMessageAt`, `lastMessagePreview`, `unreadCount + 1` (só se a mensagem for mais nova) |
   | `updateMessageAck` | `WaMessage.ack` só pra frente: `updateMany where ack in (os anteriores)` |
   | `getConversation` / `getContact` | leitura simples |
   | `findLastInboundMessage` | `WaMessage where conversationId, sentBy = CONTACT, fromMe = false orderBy sentAt desc` |
   | `recordBlockedSend` | `WaSendBlock` + `WaAgentRun.status = "blocked"`, `blockedReason` quando tiver `agentRunId` |

   O worker usa `dbAs(job.data.ownerUserId)` nos jobs (cada job já leva `ownerUserId`); só o webhook e o `findSessionByProvider` usam `prismaSystem`.
3. **Ligar o runtime.** Num arquivo carregado pelo site e pelo worker (ex.: `lib/whatsapp/setup.ts`), chamar `registerWhatsAppRuntime({ repo, queue: bullmqWaQueue, credentialsFor })`. `credentialsFor` devolve `openwaCredentialsFromEnv()` pro OpenWA e `{ cloudApi: { accessToken: decryptToken(session.accessTokenEnc) } }` pra Cloud API. Importar esse arquivo na rota do webhook e em `worker/wa-worker.ts`.
4. **Ganchos.** `createWaWorkers({ hooks })` aceita `onInboundMessage` (enfileirar `wa-agent` e publicar no Redis do SSE) e `onSessionEvent` (QR e status pro card da página Canais).
5. **Deploy.** Novo processo `tsx worker/wa-worker.ts` no Dokploy, ao lado do `dm-worker`. Não feito neste branch.

## O que fica pra depois

- Telas (Canais com QR, inbox, termo de risco) e o agente (`wa-agent`).
- Worker de mídia (`WaMedia`): o webhook só guarda id, tipo e nome do arquivo; o base64 do OpenWA não vai pra fila.
- Puxar histórico do OpenWA ao conectar (`GET /api/sessions/:id/messages/:chatId/history?limit=`; não existe `/chats/:chatId/messages`).
- Os `WaAgentRun.blockedReason` usam os mesmos códigos: `fora_da_janela_24h`, `sem_mensagem_do_contato`, `humano_assumiu`, `sessao_desconectada`.

## Revisão 06/10 (o que a Fase 0 real mudou)

O `feat/multiusuario` criou o schema `whatsapp` diferente do plano. Ao escrever o `prisma-repository.ts`:

- **Escopo é o workspace, não o dono.** `WaContact`, `WaConversation`, `WaMessage`, `WaLabel` e `WaConversationLabel` têm `workspaceId` e **não** têm `ownerUserId` (só `WaSession` tem os dois). A RLS é `app.in_current_workspace("workspaceId")` (membro do workspace ativo) e o admin só lê com `AdminAccessLog` (`app.admin_audit_ok`). Os records daqui (`ownerUserId` em contato, conversa e mensagem) viram o `workspaceId` da sessão; o `ownerUserId` do job serve pra montar o `RlsContext` (`userId` = dono da sessão, `workspaceId` = da sessão).
- **Enums:** `whatsapp."WaSentBy"` e `whatsapp."WaAgentMode"` (não `SentBy`/`AgentMode`). A migração deste branch já usa `WaSentBy`.
- **Tabelas que a Fase 0 não criou:** `WaWebhookEvent` (idempotência), `WaAgentRun`, `WaAgentProfile`, `AiCredential`, `WaMedia` e a função `app.resolve_wa_session`. Precisam entrar no `schema.prisma` antes deste branch rodar (o webhook acha a sessão com `withSystemRole`).
- `WaSendBlock` agora tem `workspaceId` e a mesma RLS das outras (o repositório preenche pelo `WaSession`).
- `WaSession.webhookSecretEnc` é opcional na Fase 0: sessão OpenWA sem segredo é recusada no webhook (`verifyHmacSignature` devolve false sem segredo). Gere com `randomBytes(32).toString("base64url")`; `registerWebhook` recusa menos de 32 caracteres e URL sem HTTPS.
- Eventos reais do OpenWA 0.24: "pronto" chega como `session.status` com `data.status = "ready"`; `GET /qr` responde 400 enquanto não há QR.
