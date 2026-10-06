# Agentes do WhatsApp (motor)

Branch `feat/wa-agentes`. Código em `lib/whatsapp/agentes/`, testes em `__tests__/wa-agentes.test.ts`.
Plano de origem: `plano-whatsapp-multiusuario.md` (fase 4).

## O que tem aqui

| Arquivo | O que faz |
|---|---|
| `types.ts` | Tipos próprios e a interface `AgentStore` (o motor não importa o Prisma) |
| `jev.ts` | Cliente do Jev (TypeSafe, `jev-latest`) só no servidor, chave em `TYPESAFE_API_KEY` |
| `triagem.ts` | Regras de custo zero + Jev: responder, não precisa, humano ou spam; qual agente; se é difícil |
| `modelos.ts` | Roteador (Haiku 4.5 ou GPT-5 mini; Sonnet 5 se difícil ou Jev incerto) e tabela de preço |
| `provedores.ts` | `fetch` em `api.anthropic.com/v1/messages` e `api.openai.com/v1/chat/completions`, com cache da parte fixa |
| `credenciais.ts` | Chave do dono com AES-256-GCM (`encryptToken` de `lib/meta/oauth.ts`); só sai `keyLast4` |
| `tom.ts` | Aprende o tom pelas mensagens do próprio usuário (`USER_PHONE`/`USER_APP`), sem dado pessoal de terceiro |
| `comando.ts` | Monta o Comando: fixo (papel, regras, Comando base, fatos, tom) + variável (trechos do cérebro, memória) |
| `guardas.ts` | Trava de preço, prazo, porcentagem e link que não estejam nas fontes |
| `bolhas.ts` | 1 a 3 bolhas curtas e ritmo humano (20 a 90 s, digitando 4 a 7 caracteres/s) |
| `modo.ts` | Camadas conversa > etiqueta > número, desligado ganha, Assumir, janela de 24h |
| `teto.ts` | Teto diário em dólar (usuário e workspace), limite de respostas da chave, envios automáticos por número, horário de silêncio |
| `motor.ts` | `processarMensagem`, `aprovarRascunho`, `rejeitarRascunho`, `podeEnviar` |

## Fluxo

1. Chega mensagem do contato. O worker chama `aoMensagemDoContato` (cancela envio que estava esperando) e depois `processarMensagem`.
2. Travas baratas: grupo, última mensagem não é do contato, mensagem mais nova chegou, fora das 24h, modo desligado, Assumir ativo.
3. Triagem. "ok", "obrigado", emoji: não responde. Reembolso, reclamação, "quero falar com alguém", áudio: passa pra humano (pausa o agente 24h na conversa e avisa).
4. Teto pelo pior caso. Se passar, não chama o modelo.
5. Modelo com a chave do dono. Erro de chave ou saldo vira aviso claro, sem travar nada.
6. Travas de conteúdo e checagem do Jev (cara de IA, guru, se respondeu o que perguntaram).
7. Rascunho por padrão. Envio sozinho só com AUTO ligado na conversa ou numa etiqueta, sem alerta, fora do silêncio, abaixo do `maxAutoPerDay` e com a janela aberta até o fim do envio.
8. O conector recebe `EnvioPlanejado[]` por `store.agendarEnvio` e, antes de cada bolha, chama `podeEnviar(runId)`. Assumir, janela fechada ou automático desligado seguram o envio mesmo que o job já esteja na fila.

"Assumir" (`assumirConversa`) e resposta do usuário pelo celular ou inbox (`aoMensagemDoUsuario`) põem `humanTakeoverUntil`, cancelam os envios e descartam rascunhos pendentes.

## Variáveis de ambiente

| Nome | Padrão | Uso |
|---|---|---|
| `TYPESAFE_API_KEY` | (vazio) | Jev. Sem ela, a triagem segue com regras e marca "incerto" (vai pro Sonnet e nunca sai sozinha sem checagem) |
| `ENCRYPTION_KEY` | já existe | Criptografia das chaves de IA |
| `WA_TETO_DIARIO_USUARIO_USD` | 1 | Teto diário por usuário |
| `WA_TETO_DIARIO_WORKSPACE_USD` | 3 | Teto diário por workspace |

A chave de IA é do dono, cadastrada na tela (`salvarChave`). O motor não lê `ANTHROPIC_API_KEY` nem `OPENAI_API_KEY` nem `OPENAI_BASE_URL`.

## Custo

Preço por 1 milhão de tokens em `modelos.ts` (Haiku 4.5: US$ 1 / 5; Sonnet 5: US$ 2 / 10; GPT-5 mini: US$ 0,25 / 2). O custo de cada run fica em `WaAgentRun.custoUsdMicro`. Na Anthropic o cache só entra quando a parte fixa passa do mínimo do modelo (no Haiku 4.5, 4.096 tokens); abaixo disso a chamada funciona igual, só sem desconto. Na OpenAI o cache é automático acima de 1.024 tokens.

## Integração com a Fase 0 (o que mudar quando juntar)

1. **Migração.** `prisma/migrations-wa/agentes/migration.sql` fica fora do `migrate deploy`. Depois que a Fase 0 criar o schema `whatsapp`, copiar pro `prisma/migrations/<data>_wa_agentes/` e pôr no `schema.prisma`:
   - `WaAgentRun`: `workspaceId`, `sessionId`, `agente`, `provider`, `cacheRead`, `cacheWrite`, `custoUsdMicro`, `triagem Json?`, `approvedBy`, e os índices.
   - `WaAgentProfile`: `fatosPermitidos Json?`, `timeZone String @default("America/Sao_Paulo")`.
   - Modelos novos `WaAgentConfig` (único por `sessionId + agente`) e `WaContactMemory` (chave = `contactId`), os dois com RLS dono ou admin.
2. **AgentStore com Prisma.** Escrever `lib/whatsapp/agentes/store-prisma.ts` implementando `AgentStore` com `dbAs(ownerUserId)` (RLS). Mapas:
   - `carregarContexto`: `WaConversation` + `WaSession.agentMode` + `WaConversationLabel -> WaLabel.agentMode` + `WaContact` + `WaAgentProfile` + últimas ~40 `WaMessage` (ordem crescente).
   - `gastoDoDia`: `SUM(custoUsdMicro)`, `COUNT(*) WHERE model IS NOT NULL` e `COUNT(*) WHERE status IN ('scheduled','sent') AND approvedBy IS NULL` desde `inicioDoDia`.
   - `runsPendentes`: `status IN ('draft','scheduled')`.
   - `credencialAtiva`: `AiCredential` mais nova sem `revokedAt` (policy `owner_only`: nem o admin lê).
   - `agendarEnvio` / `cancelarEnvios`: fila `wa-send` do conector (BullMQ, job com atraso). O job de cada bolha chama `podeEnviar`, mostra "digitando..." por `digitandoMs` e envia com `Idempotency-Key = runId:índice`. Quando a última bolha sai, `atualizarRun(runId, { status: "sent" })` e grava `WaMessage` com `sentBy = AGENT` e `agentRunId`.
3. **Cérebro.** `BrainRetriever` é a interface que o agente do cérebro (branch `feat/wa-cerebro`) implementa. Até lá, um retriever vazio funciona (o agente só cita o que está no Comando base e nos fatos).
4. **Worker.** No `wa-worker`: em `message.received` chamar `aoMensagemDoContato` e enfileirar `processarMensagem` com um pequeno atraso (3 a 5 s) pra juntar mensagens seguidas; em `message.sent` vindo do celular (`USER_PHONE`) chamar `aoMensagemDoUsuario`.
5. **Telas.** Rascunhos em `/inbox/whatsapp` (aprovar, editar, recusar), botão "Assumir", chave de IA por provedor, modo por conversa e etiqueta, e o agente/modelo de cada um dos 3. Mensagens de erro prontas em `mensagemErro` e `mensagemTeto`.
