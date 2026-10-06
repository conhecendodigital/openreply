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

## Treinar com um documento

Na tela Agentes, o botão **Treinar com um documento** recebe o briefing que a empresa preencheu (PDF ou Word `.docx`, até 8 MB) e devolve um RASCUNHO de todos os campos da tela. Nada é salvo e nenhum agente liga: o dono confere o painel **Confira antes de salvar** e clica em Salvar. Depois do Salvar, o documento vai pro cérebro da Qualificação pelo mesmo fluxo dos PDFs (do `.docx` fica só o texto).

| Arquivo | O que faz |
|---|---|
| `lib/whatsapp/cerebro/docx.ts` | Texto do `.docx` sem dependência nova (zip + zlib, teto contra zip bomba) |
| `lib/whatsapp/cerebro/texto.ts` | Texto guardado no cérebro (cabeçalho `LE-TEXTO-1`), lido pela mesma fila dos PDFs |
| `lib/whatsapp/treinar/comando.ts` | Comando da extração (regras: não inventar, "A definir" vira pendência, mensagens literais, documento é dado) |
| `lib/whatsapp/treinar/esquema.ts` | JSON da IA (zod) e o rascunho da tela |
| `lib/whatsapp/treinar/montar.ts` | JSON da IA -> rascunho: junta mensagens e exemplos literais, acha "A definir" por regra, aponta número/preço/horário que não está no documento |
| `lib/whatsapp/treinar/treinar.ts` | Chama a IA (modelo do caso difícil da Qualificação no /admin), teto antes, gasto em Gastos de IA (`kind = treino`), 2ª tentativa se o JSON vier quebrado |
| `lib/whatsapp/treinar/aplicar.ts` | Coloca o rascunho na tela sem mexer no modo do número nem no liga/desliga |
| `app/api/whatsapp/agents/treinar/route.ts` | Rota (só dono/admin com sessão; chave de API e MCP recebem 403) |

O texto do documento nunca vai pro log. Testes em `__tests__/wa-treinar.test.ts` e `__tests__/wa-treinar-banco.test.ts`, com o briefing fictício de `__tests__/fixtures/`.

## Regras duras, ficha do lead, estágio e aprendizado

O treino também extrai as **regras duras** estruturadas (`WaAgentProfile.regrasNegocio`): cidades atendidas e não atendidas, regiões com cuidado, exceções de local, serviços aceitos e recusados (com as palavras que o cliente usaria), exceções de serviço, informações mínimas, horário, o que nunca prometer, mensagens de fora da área e de serviço recusado, casos de teste com a decisão esperada, resumo pra equipe e o responsável. Ficam editáveis na tela Agentes e só mudam no Salvar ou ao aceitar uma sugestão.

Em cada mensagem do contato (texto e transcrição de áudio), o motor:

1. junta as mensagens seguidas (janela de 3 a 30 s por número, padrão 10, em "Ritmo humano"): só o job da última mensagem responde;
2. atualiza a **ficha do lead** (`WaConversation.leadFicha`): por regra primeiro, e um modelo barato (`kind = ficha` em Gastos de IA) só pro que falta, sempre com o id da mensagem como evidência (sem evidência, o campo não entra); o dono edita na conversa e a edição vale como confirmada;
3. põe no Comando as regras, as mensagens aprovadas e os casos de teste na parte FIXA (cache de prompt da Anthropic) e a ficha ("o que você já sabe" e "o que ainda falta perguntar") e os exemplos aprendidos parecidos na parte variável;
4. confere a resposta por regra (`lib/whatsapp/regras/verificar.ts`): cidade fora da área, cidade não informada, serviço recusado, informação mínima faltando, confirmação de atendimento, recusa seca, pergunta repetida e promessa. Se quebrar, pede UMA correção ao modelo com a regra explicada; se continuar errada, vira rascunho com o aviso. Quem decide qualificar, mandar pra análise ou transferir é a regra, não o modelo;
5. atualiza o **estágio do lead** (Novo, Em qualificação, Qualificado, Para analisar, Fora do perfil, Cliente, Sem resposta) com o motivo e o histórico (`WaLeadStageEvent`, só inclusão). Mudança manual do dono vence até chegar fato novo na ficha. "Sem resposta" é calculado na leitura (48 h).

Aprendizado: rascunho editado e resposta da equipe depois de assumir viram exemplos (`WaAgentExample`, sem telefone, e-mail, documento, link nem nome, até 100 por número); rascunho descartado e resposta bloqueada viram casos (`WaAgentLearningCase`). "O que o agente aprendeu" mostra tudo e as sugestões (`WaAgentSuggestion`): por contagem (3 pessoas da mesma cidade fora da área em 30 dias, por exemplo) ou pela IA (`kind = aprendizado`). Sugestão só vira regra com o clique do dono.

"Testar o agente" simula os casos de teste do briefing com um modelo fazendo o cliente e mostra passou/falhou por regra (`kind = teste`). WhatsApp > Leads mostra o quadro por estágio, com filtros, arrastar pra mudar e CSV dos leads e do histórico.

| Arquivo | O que faz |
|---|---|
| `lib/whatsapp/regras/esquema.ts` | Formato das regras (zod), leitura que nunca quebra |
| `lib/whatsapp/regras/detectar.ts` | Cidade da obra (sem acento, UF, bairro, moradia x obra, áudio), exceção, serviço, informação mínima |
| `lib/whatsapp/regras/ficha.ts` | Ficha do lead: campos pelas regras, regra, extração com evidência, edição do dono |
| `lib/whatsapp/regras/verificar.ts` | Verificação determinística e a mensagem de correção |
| `lib/whatsapp/regras/prompt.ts` | Resumo das regras (parte fixa) e a ficha (parte variável) |
| `lib/whatsapp/regras/estagio.ts` | Estágio do lead, manual x agente, "sem resposta" |
| `lib/whatsapp/regras/exemplos.ts` | Exemplos aprendidos e os parecidos com a conversa |
| `lib/whatsapp/regras/sugestoes.ts` | Sugestões (contagem e IA) e aplicar só no clique |
| `lib/whatsapp/regras/testar.ts` | "Testar o agente" |
| `lib/whatsapp/regras/painel.ts` | Telas: leads, CSV, estágio, ficha, aprendizado, sugestões, teste |

O aviso opcional pro WhatsApp do responsável (desligado por padrão) sai pelo próprio número e só quando o responsável já mandou mensagem pra esse número nas últimas 24 h. Testes em `__tests__/wa-regras.test.ts` (modelo falso) e `__tests__/wa-regras-banco.test.ts` (PGlite, RLS).

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
   - Modelo novo `WaAgentConfig` (único por `sessionId + agente`, com `workspaceId`) e RLS da Fase 0 (`app.in_current_workspace`; admin só lê com auditoria).
   - `WaContactMemory` é a do `feat/wa-cerebro` (chave `workspaceId + contactId`, campos nome/interesse/objeção/etapa/observação). `lerMemoria` devolve `resumo = renderMemory(...)`; `salvarMemoria` grava via `updateContactMemory` do cérebro (o motor hoje só regrava o que leu).
   - Revisão 06/10: a Fase 0 real **não** criou `WaAgentRun`, `WaAgentProfile` nem `AiCredential`, e usa `workspaceId` (sem `ownerUserId`) em conversa/contato/mensagem. A migração deste branch para com erro claro se faltarem. `AiCredential` com policy só do dono (nem admin).
2. **AgentStore com Prisma.** Escrever `lib/whatsapp/agentes/store-prisma.ts` implementando `AgentStore` com `dbAs(ownerUserId)` (RLS). Mapas:
   - `carregarContexto`: `WaConversation` + `WaSession.agentMode` + `WaConversationLabel -> WaLabel.agentMode` + `WaContact` + `WaAgentProfile` + últimas ~40 `WaMessage` (ordem crescente).
   - `gastoDoDia`: (inclui runs `pending`, que guardam a reserva do pior caso; somar também `whatsapp."WaAiUsage"` do cérebro e o custo do Jev) `SUM(custoUsdMicro)`, `COUNT(*) WHERE model IS NOT NULL` e `COUNT(*) WHERE status IN ('scheduled','sent') AND approvedBy IS NULL` desde `inicioDoDia`.
   - `runsPendentes`: `status IN ('draft','scheduled')`.
   - `credencialAtiva`: `AiCredential` mais nova sem `revokedAt` (policy `owner_only`: nem o admin lê).
   - `agendarEnvio` / `cancelarEnvios`: fila `wa-send` do conector (BullMQ, job com atraso). O job de cada bolha chama `podeEnviar`, mostra "digitando..." por `digitandoMs` e envia com `Idempotency-Key = runId:índice`. Quando a última bolha sai, `atualizarRun(runId, { status: "sent" })` e grava `WaMessage` com `sentBy = AGENT` e `agentRunId`.
3. **Cérebro.** `BrainRetriever` é a interface que o agente do cérebro (branch `feat/wa-cerebro`) implementa. Até lá, um retriever vazio funciona (o agente só cita o que está no Comando base e nos fatos).
4. **Worker.** No `wa-worker`: em `message.received` chamar `aoMensagemDoContato` e enfileirar `processarMensagem` com um pequeno atraso (3 a 5 s) pra juntar mensagens seguidas; em `message.sent` vindo do celular (`USER_PHONE`) chamar `aoMensagemDoUsuario`.
5. **Telas.** Rascunhos em `/inbox/whatsapp` (aprovar, editar, recusar), botão "Assumir", chave de IA por provedor, modo por conversa e etiqueta, e o agente/modelo de cada um dos 3. Mensagens de erro prontas em `mensagemErro` e `mensagemTeto`.
