# Canais > Conexões e chaves

Pedido do dono (06/10/2026): "preciso que as apis e conexões fiquem tudo em canais para colocar as chaves".

## O que fica na tela

| Cartão | Campos | Onde é lido |
| --- | --- | --- |
| WhatsApp · uazapi | Server URL, Admin token, Dispositivos do plano | painel (Conexões), webhook, wa-worker |
| WhatsApp · gateway OpenWA | URL do gateway, chave operator | painel (Conexões), webhook, wa-worker |
| WhatsApp · API oficial | nenhum (em breve, depois da aprovação da Meta) | - |
| Pixel e API de Conversões | os mesmos de antes (`MetaCapiSettings`) | quizzes (`lib/meta/capi.ts`) |
| Chaves de IA (plataforma) | só status, só pro admin da plataforma | `/admin` > Chaves de IA |

Só dono e admin do workspace, logados, veem e mudam. Chave de API e MCP recebem 403.

## Precedência

`lib/integrations/credentials.ts`, a mesma função pra site, webhook, painel e wa-worker:

1. o que o workspace salvou em Canais (URL **e** chave juntas);
2. as variáveis do servidor (`UAZAPI_SERVER_URL`, `UAZAPI_ADMIN_TOKEN`, `UAZAPI_MAX_INSTANCES`, `OPENWA_BASE_URL`, `OPENWA_API_KEY`);
3. não configurado.

Nunca mistura os dois lados: uma URL salva no workspace nunca recebe a chave do servidor. O worker acha a credencial pelo `workspaceId` do número. `WHATSAPP_ENABLED` continua só no ambiente (a tela mostra se está ligado).

Cache de 30 s por processo. Salvar ou remover limpa na hora no processo do site; o wa-worker pega a troca em até 30 s.

## Segurança

- Valor cifrado (AES-256-GCM, `ENCRYPTION_KEY`). A resposta só tem "salvo", os 4 últimos caracteres, quem trocou e quando.
- Tabelas `WorkspaceIntegrationCredential` e `WorkspaceIntegrationAudit` (migração `20261018120000_canais_chaves`), RLS forçada: só dono/admin do workspace ativo pelo `le_app`; workers pelo `le_system`. Auditoria só cresce.
- URL salva: só `https://`, sem usuário/senha, sem localhost, rede interna, link local, nome sem ponto (serviço do Docker) ou sufixo interno; o DNS é conferido ao salvar e antes de cada teste. O que vem do ambiente não passa por essa checagem (é o operador quem põe).
- Limites: 20 mudanças e 10 testes a cada 10 minutos por pessoa.

## Rotas

| Método | Rota | O que faz |
| --- | --- | --- |
| GET | `/api/channels/integrations` | status de cada serviço, últimas mudanças, WHATSAPP_ENABLED e (admin da plataforma) status da IA |
| PUT | `/api/channels/integrations/{uazapi|openwa}/{campo}` | salvar ou trocar `{ "value": "..." }` |
| DELETE | `/api/channels/integrations/{uazapi|openwa}/{campo}` | remover |
| POST | `/api/channels/integrations/{uazapi|openwa}/test` | uazapi: `GET /status` e `GET /instance/all`; OpenWA: `GET /api/health` |

O Pixel e a API de Conversões continuam em `/api/workspace/meta-capi` (mesmos dados); só a tela mudou de Configurações pra Canais.
