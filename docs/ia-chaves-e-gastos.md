# Chaves de IA e Gastos de IA

Data: 06/10/2026. Branch: `feat/multiusuario` (em cima da Fase 0).

Pedidos do dono: "as API quero colocar a chave no admin" e "quero relatório de gasto das APIs e de clientes".

## O que o dono faz

1. Entre no Lead Engine com o 2FA e abra **/admin**.
2. Em **Chaves de IA**, cole a chave de cada provedor (Claude/Anthropic, OpenAI, TypeSafe/Jev) e clique em **Salvar**. Depois disso a tela só mostra "termina em ••••abcd".
3. Clique em **Testar**. Aparece "A chave funciona." ou o erro do provedor em português.
4. Pra trocar: **Trocar**, cole a nova, **Salvar**. Pra tirar: **Remover**.
5. Logo abaixo: modelo de cada agente (qualificação, atendimento, suporte), tetos por dia (usuário e workspace), tabela de preços e cotação do dólar (opcional). **Salvar configurações**.
6. Em **Gastos de IA**: filtros (hoje, 7 dias, 30 dias, mês atual, personalizado; usuário, workspace, agente, provedor, modelo), totais, gasto por dia, quem mais gasta, custo médio por conversa e por resposta, % do teto de hoje e **Exportar CSV**. Quem passa de 80% do teto do dia aparece num aviso amarelo no topo.

Cada usuário do beta vê o próprio gasto em **Configurações > Meu gasto de IA** (com o mesmo aviso de 80%, só dele).

## Banco (migração `20261014120000_ia_chaves_e_gastos`, só adiciona)

| Tabela | O que guarda | Quem lê e grava |
|---|---|---|
| `public.PlatformAiCredential` | 1 chave por provedor, `keyEnc` (AES-256-GCM, `encryptToken` de `lib/meta/oauth.ts`, `ENCRYPTION_KEY`), `keyLast4`, `active`, `createdById`, `updatedById` | só o admin (RLS `app.is_admin()`); agentes leem pelo `le_system` |
| `public.PlatformAiSettings` | linha única `global`: modelo por agente, tetos (US$ 1 usuário, US$ 3 workspace), preços, cotação | igual |
| `whatsapp.WaAiUsage` | 1 linha por chamada paga ou barrada pelo teto | cada usuário lê as dele, o admin lê todas; ninguém edita nem apaga pelo `le_app` |

Toda mudança de chave ou de configuração grava em `AdminAccessLog` (`targetWorkspaceId = "platform"`, `resource = "ai.credential"` ou `"ai.settings"`, `resourceId` = provedor, `reason` = "salvou a chave", "trocou a chave", "removeu a chave"). A chave nunca vai pro log.

Se a migração avisar que não deu pra dar as permissões, rode como superusuário os `GRANT` do fim do arquivo.

## Segurança

- A chave aberta nunca volta em resposta de API, página, log, erro ou MCP. As rotas devolvem só provedor, 4 últimos caracteres e datas. O erro do provedor passa por `redactSecrets` antes de sair.
- Rotas novas: `/api/admin/ai`, `/api/admin/ai/settings`, `/api/admin/ai/credentials/[provider]`, `/api/admin/ai/credentials/[provider]/test`, `/api/admin/ai/usage` (só admin com 2FA) e `/api/account/ai-usage` (a própria pessoa). Nenhuma está em `lib/api-key-routes.ts`: chave de API recebe 403 no `proxy.ts` e de novo na rota.
- **Testar**: 10 testes a cada 10 minutos por admin. URLs oficiais fixas (`api.anthropic.com`, `api.openai.com`, `api.typesafe.ai`); `OPENAI_BASE_URL` do ambiente é ignorado.
  - Anthropic: `POST /v1/messages`, `max_tokens: 1`, `claude-haiku-4-5-20251001`.
  - OpenAI: `GET /v1/models` (não gasta token).
  - TypeSafe: `POST /v1/systemone`, 1 pergunta `noul` e estado mínimo (contrato do `scripts/jev.py`).
- Trocar a `ENCRYPTION_KEY` faz as chaves salvas não abrirem mais (`getAiCredential` devolve `null`): cadastre de novo.

## Interface pros agentes (`lib/ai/credentials.ts` e `lib/ai/usage.ts`)

```ts
import { getAiCredential, getAgentModelConfig } from "@/lib/ai/credentials";
import { checkDailyCap, recordAiUsage, costMicroUsd } from "@/lib/ai/usage";

const cred = await getAiCredential("anthropic");   // { provider, apiKey, keyLast4 } ou null
const cfg = await getAgentModelConfig("atendimento");
// { agent, provider, model, hardModel, dailyCapUserUsd, dailyCapWorkspaceUsd }

const teto = await checkDailyCap({ ownerUserId, workspaceId, expectedCostMicroUsd });
if (!teto.ok) {
  await recordAiUsage({ ownerUserId, workspaceId, kind: "agent", agent: "atendimento", provider: cfg.provider, model: cfg.model, conversationId, blocked: true });
  // teto.reason = "teto_usuario" | "teto_workspace" (mesmos nomes de teto.ts)
}
// ... chama o modelo ...
await recordAiUsage({ ownerUserId, workspaceId, kind: "agent", agent: "atendimento", provider: "anthropic", model,
  contactId, conversationId, tokensIn, tokensOut, cacheRead, cacheWrite, refId: runId });
```

### O que muda no branch `feat/wa-agentes`

| Antes | Depois |
|---|---|
| `process.env.TYPESAFE_API_KEY` em `lib/whatsapp/agentes/jev.ts` (`perguntarJev`, `jevConfigurado`) | `const jev = await getAiCredential("typesafe")` e passar `opcoes.apiKey = jev?.apiKey`; `jevConfigurado(jev?.apiKey)` |
| Chave do dono: `AiCredential` + `salvarChave` / `abrirChave` / `store.credencialAtiva` | `getAiCredential(config.provider)`. A tabela `AiCredential` por dono e `credenciais.ts` deixam de ser necessárias no beta (a chave é da plataforma) |
| `WaAgentConfig.provider` / `modelo` / `modeloDificil` | `getAgentModelConfig(agente)` dá o padrão da plataforma. Se o `WaAgentConfig` continuar existindo, ele só liga e desliga o agente e guarda as instruções |
| `PRECOS` e `custoUsdMicro` em `modelos.ts` | `costMicroUsd(settings.prices[modelo], uso)` com `getAiSettings()` (a tabela é editável no /admin) |
| `WA_TETO_DIARIO_USUARIO_USD` / `WA_TETO_DIARIO_WORKSPACE_USD` (`limitesDoAmbiente`) | `cfg.dailyCapUserUsd` / `cfg.dailyCapWorkspaceUsd`, ou `checkDailyCap` direto |
| `WaAgentRun.custoUsdMicro` somado em `gastoDoDia` | continua no run, e cada chamada também vai pra `recordAiUsage` (o relatório e o teto leem `WaAiUsage`) |

O `lib/moderation/jev.ts` (moderação do Instagram) ainda lê `TYPESAFE_API_KEY`. Pra usar a chave do admin, troque `process.env.TYPESAFE_API_KEY?.trim()` por `(await getAiCredential("typesafe"))?.apiKey`. Enquanto ninguém trocar, as duas convivem.

### Encaixe com o branch `feat/wa-cerebro`

A tabela `whatsapp."WaAiUsage"` desta migração tem todas as colunas que o `SqlUsageRecorder` do cérebro grava (`ownerUserId`, `workspaceId`, `kind`, `provider`, `model`, `tokensIn`, `tokensOut`, `costMicroUsd`, `refId`, `createdAt`), com os mesmos tipos. Na junção:

1. Tirar o bloco `CREATE TABLE whatsapp."WaAiUsage"`, o índice `WaAiUsage_owner_created_idx` e `'WaAiUsage'` do laço de RLS de `prisma/migrations-wa/cerebro/migration.sql` (a tabela e a RLS já vêm daqui; lá a policy era por workspace, aqui é por usuário, como o dono pediu).
2. O `SqlUsageRecorder.record` funciona sem mudança. Melhor ainda: trocar por `recordAiUsage({ ..., agent: "cerebro" })`, que calcula o custo pela tabela do /admin.
3. `spentTodayMicroUsd(ownerUserId)` do cérebro e o `spentTodayMicroUsd({ ownerUserId })` daqui somam a mesma coisa.

## Preços iniciais (dólar por 1 milhão de tokens, editáveis no /admin)

| Modelo | Entrada | Saída | Cache lido | Cache gravado |
|---|---|---|---|---|
| `claude-haiku-4-5-20251001` | 1 | 5 | 0,10 | 1,25 |
| `claude-sonnet-5` | 2 | 10 | 0,20 | 2,50 |
| `gpt-5-mini` | 0,25 | 2 | 0,025 | 0 |
| `text-embedding-3-small` | 0,02 | 0 | 0 | 0 |
| `jev-latest` (TypeSafe) | 0,042 | 0 | 0 | 0 |

O custo de cada chamada é gravado com o preço daquele momento. A chamada do botão Testar não entra no relatório (custa menos de 1 centésimo de centavo e não é de nenhum cliente).
