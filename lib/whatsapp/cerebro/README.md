# Cérebro dos agentes de WhatsApp

Base de conhecimento por agente (PDF -> pedaços com embedding no pgvector) e
memória curta por contato. Branch `feat/wa-cerebro`.

## Peças

| Arquivo | O que faz |
|---|---|
| `types.ts` | Tipos próprios (agentes `qualificacao`, `atendimento`, `suporte`; documento, pedaço, memória, gasto) |
| `limits.ts` | Todos os limites (8 MB, 200 páginas, 30 PDFs por agente, pedaço de 1200 caracteres com 200 de sobreposição, busca de 3 a 5 trechos com limiar 0,3, memória até 800 caracteres) |
| `pdf.ts` | Tipo pelos bytes (`%PDF-`), contagem de páginas, texto por página, PDF com senha e PDF sem texto |
| `chunk.ts` | Pedaços com sobreposição, respeitando parágrafo e frase |
| `embeddings.ts` | Interface `EmbeddingProvider` + OpenAI `text-embedding-3-small` (1536 dimensões) por `fetch`, sempre em api.openai.com |
| `sql.ts` | Executor de SQL cru com `set_config('app.user_id', ...)` na transação (RLS) |
| `store.ts` | Documentos, pedaços, busca por cosseno, memória (com versão) e registro de gasto |
| `search.ts` | `searchKnowledge` (embedding da pergunta + vizinhos + limiar) e `formatKnowledgeForCommand` |
| `memory.ts` | `updateContactMemory`: Comando de resumo, leitura do JSON, limites, descarte de CPF/cartão/senha |
| `ingest.ts`, `queue.ts` | Fila `wa-cerebro` (BullMQ): texto -> pedaços -> embeddings -> banco, com novas tentativas |
| `upload.ts` + `app/api/whatsapp/cerebro/[agent]/documents` | Envio (POST), lista (GET) e apagar (DELETE `.../[id]`) |
| `service.ts` | Montagem padrão com o Prisma |
| `worker/wa-cerebro-worker.ts` | `npm run worker:cerebro` |

## Por que `unpdf`

- É o PDF.js da Mozilla (o leitor do Firefox) empacotado pra servidor. MIT, zero dependências, ~2 MB.
- Sem binário nativo. O `pdf-parse` v2 puxa `@napi-rs/canvas` (binário) e o v1 está parado.
- O `pdfjs-dist` puro tem 35 MB e pede montar o worker na mão no Node.
- O PDF.js 6 empacotado não usa `eval`/`new Function`. Rodamos sem fontes do sistema e com `verbosity: 0`.
- Ele não lê PDF escaneado (só imagem): esse vira `pdf_no_text`. OCR fica pra depois.

## Rotas (só sessão de pessoa logada)

- `GET /api/whatsapp/cerebro/:agent/documents`: lista (qualquer membro do workspace).
- `POST /api/whatsapp/cerebro/:agent/documents`: `multipart/form-data` com `file`. Só dono ou admin do workspace.
  Confere Content-Length, tamanho, bytes `%PDF-`, páginas, senha e o limite de 30 PDFs. Grava como `queued` e põe na fila.
  O mesmo PDF (sha256) no mesmo agente devolve o que já existe (200, `duplicate: true`).
  Respostas: 202 na fila, 400/409/413/415 com `code`, 429 com muitos envios (30 por hora), 503 sem fila.
- `DELETE /api/whatsapp/cerebro/:agent/documents/:id`: apaga o PDF e os pedaços dele.
- Chave de API: 403 (`humanOnly` na rota e `proxy.ts`, porque a rota não está em `lib/api-key-routes.ts`).
- 8 MB porque o `proxy.ts` do Next guarda só 10 MB do corpo (`proxyClientMaxBodySize`). Acima disso o corpo chegaria cortado.

## Uso pelo agente (fase 4)

```ts
const { store, usage } = cerebroForUser(ownerUserId, workspaceId);
const { hits } = await searchKnowledge(
  { scope: { ownerUserId, workspaceId }, agentKind: "atendimento", sessionId, question: textoDoContato, refId: messageId },
  { store, embedder, usage }
);
const conhecimento = formatKnowledgeForCommand(hits);
const memoria = renderMemory(await store.getMemory(workspaceId, contactId));
// ...depois de responder:
await updateContactMemory({ scope, contactId, messages }, { store, model, usage });
```

`model` (interface `MemoryModel`) é o cliente de IA do agente (Claude Haiku 4.5 ou GPT-5 mini com a chave do dono).
O cérebro não conhece SDK de IA nenhum.

## Gasto

Toda chamada paga grava uma linha em `whatsapp."WaAiUsage"`: tipo (`embedding` / `memory`), provedor, modelo,
tokens de entrada e saída e custo estimado em micro dólares (`text-embedding-3-small` = US$ 0,02 por milhão).
`SqlUsageRecorder.spentTodayMicroUsd(ownerUserId)` soma o dia (fuso de Brasília) pro teto diário.
O documento também guarda `embeddingTokens`.

## Banco

SQL em `prisma/migrations-wa/cerebro/migration.sql` (desfazer: `down.sql`). Fora de `prisma/migrations` de propósito.

- `WaKnowledgeDocument`: o PDF (bytes guardados pra reprocessar), status, erro, páginas, pedaços e tokens.
- `WaKnowledgeChunk`: texto, página e `embedding vector(1536)` com índice HNSW (`vector_cosine_ops`, m=16, ef_construction=64).
- `WaContactMemory`: nome, interesse, objeção, etapa e observação, com limite de tamanho no banco também.
- `WaAiUsage`: gasto de IA.
- RLS ligada e forçada nas 4, igual às tabelas `whatsapp.*` da Fase 0: `app.in_current_workspace("workspaceId")`
  (workspace ativo + membro) e admin só lê com auditoria (`app.admin_audit_ok`). O executor marca `app.user_id`,
  `app.workspace_id` e troca o papel pra `le_app` (`DB_RLS_ROLE`) em toda transação.

## Quando juntar com a Fase 0

1. Rode a migração da Fase 0 antes (ela cria `le_app`, `le_system`, `app.my_workspace_ids()` e `app.is_admin()`).
   A migração do cérebro para com erro claro se faltar algo.
2. O Postgres precisa da extensão `vector` (imagem `pgvector/pgvector`, pgvector 0.5 ou mais novo pro HNSW).
3. Rode o SQL como `le_owner`: `psql "$DATABASE_URL_OWNER" -f prisma/migrations-wa/cerebro/migration.sql`.
   Ou copie pra uma pasta nova em `prisma/migrations/<data>_wa_cerebro/` depois das migrações da Fase 0/1.
4. Em `service.ts`, troque `prisma` por `getAppPrisma()` da Fase 0. O executor já marca `app.user_id`,
   `app.workspace_id` e o papel `le_app`.
4b. `WaContactMemory` também é criada pelo `feat/wa-agentes` com OUTRO formato (chave `contactId`, `resumo`/`fatos`).
   Fica a deste branch (por workspace, campos com limite); o `AgentStore.lerMemoria/salvarMemoria` dos agentes
   lê e grava aqui (`renderMemory` vira o `resumo`). A migração dos agentes não cria mais a tabela.
5. Registre a chave do dono: `setOwnerOpenAIKeyLookup(async (userId) => decifrar(AiCredential openai))`.
   Sem isso, todo PDF termina com erro `no_embedding_key`. Quem só tem chave da Anthropic não tem embedding
   (a Anthropic não vende): mostre esse aviso na tela, ou ligue um modelo local.
6. Quando a tabela `WaContact` existir, ligue a FK de `WaContactMemory."contactId"` (comentário no SQL).
7. Se os agentes ganharem id próprio (tabela de agente), dá pra adicionar `agentId` aos documentos.
   Hoje a base é por workspace + tipo de agente (e `sessionId` opcional, já pronto no banco e na busca).
8. Se o ramo dos agentes criar outra tabela de gasto, aponte o `UsageRecorder` pra ela.
9. Suba o worker: `npm run worker:cerebro` (mesmo `REDIS_URL` do worker de DM).

## Trocar o embedding por modelo local

Implemente `EmbeddingProvider` (ou use `createOpenAIEmbeddingProvider({ baseUrl: "http://ollama:11434/v1", model, apiKey: "x" })`)
e devolva-o no `EmbeddingProviderResolver`. A coluna é `vector(1536)`: um modelo com outra dimensão precisa de coluna nova
(o processamento recusa com `embedding_dimensions`). Cada pedaço guarda o modelo e a busca só compara vetores do mesmo modelo,
então dá pra trocar e reprocessar aos poucos (os bytes do PDF ficam guardados).

## Testes

`__tests__/wa-cerebro.test.ts` (vitest). PDFs reais montados no próprio teste, embeddings sempre falsos (fetch mockado).
O projeto não tem PGlite nem Postgres local, então a busca no pgvector é testada pelo SQL gerado (operador `<=>`,
filtros, lotes, transação) e por um banco falso que calcula o cosseno. Antes de produção, rode uma vez num Postgres com
pgvector: suba um PDF, confira `status = 'ready'` e rode `searchKnowledge` com uma pergunta do PDF.
