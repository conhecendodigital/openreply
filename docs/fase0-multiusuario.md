# Fase 0: login novo e Lead Engine multiusuário

Data: 06/10/2026. Branch: `feat/multiusuario`.

O que muda:

- O login sai do NextAuth e vai pro **Better Auth**. Três jeitos de entrar: **senha**, **Google** e **link por e-mail** (Resend, como hoje).
- **2FA** com app autenticador (Google Authenticator, Authy), com **10 códigos de recuperação**. Obrigatório pro admin, opcional pros outros. O código é pedido nos três jeitos de entrar.
- **Allowlist**: só entra quem está no `ALLOWED_EMAILS`, na tabela `BetaAllowlist` (você gerencia em `/admin`) ou foi convidado pra um workspace.
- **Admin da plataforma** (`User.role = ADMIN`): vê usuários, status e números. Abrir conversa de outro workspace só com registro em `AdminAccessLog`.
- **Schema `whatsapp`** no mesmo Postgres, com as tabelas vazias e **RLS ligada desde o primeiro dia**.
- Chave de API e MCP: **nada muda**. Continuam presas ao workspace onde foram criadas.
- Todo mundo entra de novo uma vez (as sessões antigas do NextAuth não valem mais).

Telas novas: `/login` (senha, Google, link), `/login/2fa` (código), `/account/password` (criar senha no primeiro acesso), `/account/two-factor` (ligar o 2FA com QR code), Configurações > **Segurança** (trocar senha, 2FA, sessões abertas, sair) e `/admin`.

---

## 1. Criar o login com Google (uma vez)

1. Abra https://console.cloud.google.com e escolha (ou crie) um projeto, por exemplo "Lead Engine".
2. Menu **APIs e serviços > Tela de consentimento OAuth**: tipo **Externo**, nome "Lead Engine", e-mail de suporte e o domínio `leadenginer.com` em "Domínios autorizados". Escopos: só `email`, `profile` e `openid` (os padrões). Salve e clique em **Publicar app** (senão só os e-mails de teste conseguem entrar).
3. Menu **APIs e serviços > Credenciais > Criar credenciais > ID do cliente OAuth**.
   - Tipo: **Aplicativo da Web**.
   - Origens JavaScript autorizadas: `https://many.leadenginer.com`
   - URIs de redirecionamento autorizados: `https://many.leadenginer.com/api/auth/callback/google`
4. Copie o **ID do cliente** e a **chave secreta** pras variáveis `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.

Sem essas duas variáveis, o botão do Google simplesmente não aparece. Senha e link continuam funcionando.

Segurança: o Google só é ligado a uma conta que já existe quando o próprio Google confirmou o e-mail. E-mail fora da allowlist não entra com Google.

---

## 2. Variáveis no Dokploy (web e worker)

Coloque nas **duas** aplicações (web e worker), igual:

| Variável | Valor |
|---|---|
| `BETTER_AUTH_SECRET` | gere com `openssl rand -base64 32` (nunca reaproveite de outro lugar) |
| `BETTER_AUTH_URL` | `https://many.leadenginer.com` (sem barra no fim) |
| `GOOGLE_CLIENT_ID` | do passo 1 |
| `GOOGLE_CLIENT_SECRET` | do passo 1 |
| `ADMIN_EMAILS` | o seu e-mail de login de hoje |

Continuam como estão: `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `ALLOWED_EMAILS`, `DATABASE_URL`.

Opcionais (RLS, ver seção 5): `DATABASE_URL_APP`, `DB_RLS_ROLE`, `DB_SYSTEM_ROLE`.

---

## 3. Virada em produção (ordem)

### Antes (no dia anterior)

1. **Backup**: `pg_dump -Fc "$DATABASE_URL" > leadengine-antes-fase0.dump`. Guarde fora do servidor.
2. **Teste de restauração** num banco à parte: `createdb teste_fase0 && pg_restore -d teste_fase0 leadengine-antes-fase0.dump`.
3. **Ensaio completo nesse banco de teste**, do seu computador, com este branch:
   ```
   DATABASE_URL=postgresql://.../teste_fase0 npx prisma migrate deploy
   DATABASE_URL=postgresql://.../teste_fase0 npx tsx scripts/migrar-login-better-auth.ts --admin=SEU_EMAIL
   DATABASE_URL=postgresql://.../teste_fase0 npx tsx scripts/migrar-login-better-auth.ts --admin=SEU_EMAIL --aplicar
   ```
   A primeira rodada do script é só simulação e mostra o que vai mudar. Confira:
   - "e-mail duplicado" tem de estar vazio;
   - "admin sem usuário no banco" tem de estar vazio (senão o e-mail está diferente do que você usa pra entrar);
   - "linhas por tabela" tem de dar `ok` em todas.
4. Confira que as tabelas estão no schema `public` (o Prisma agora usa os schemas `public` e `whatsapp` pelo nome): `psql "$DATABASE_URL" -c 'select current_schema()'` deve responder `public`, e o `DATABASE_URL` não pode ter `?schema=` com outro nome.

### No dia (num horário calmo, fora do ciclo das 22h)

1. Variáveis da seção 2 no Dokploy (web e worker).
2. Deploy do branch `feat/multiusuario` no **web**. O start roda `prisma migrate deploy` sozinho: a migração `20261013120000_multiusuario_login_whatsapp` só **adiciona** (colunas novas em `User`, tabelas novas, schema `whatsapp`, funções e policies de RLS). Nada é apagado.
3. Rode o script de dados **no container do web** (terminal do Dokploy):
   ```
   npx tsx scripts/migrar-login-better-auth.ts --admin=SEU_EMAIL
   npx tsx scripts/migrar-login-better-auth.ts --admin=SEU_EMAIL --aplicar
   ```
   Ele pode rodar de novo quantas vezes quiser, sem efeito colateral.
4. Deploy do **worker** e do **cron** (mesma imagem). Eles não usam login, mas precisam do cliente Prisma novo.
5. Teste você mesmo:
   1. Abra `/login`, peça o **link por e-mail** e entre. Como você é admin, o painel manda pra ligar o **2FA**: leia o QR code, digite o código e **guarde os 10 códigos de recuperação**.
   2. Crie a **senha** (tela de primeiro acesso, ou Configurações > Segurança).
   3. Saia e entre com **senha**: tem de pedir o código do 2FA.
   4. Em Configurações > Segurança, **Conectar o Google**. Saia e entre com **Google**: também pede o código.
   5. Confira que estão iguais: Instagram conectado, campanhas, quizzes, contatos, membros (Kayanne), convites e **chaves de API**. Rode uma chamada do MCP pra confirmar que a chave segue funcionando.
   6. Em `/admin`, confira a lista do beta e adicione os e-mails dos usuários do beta.
6. Avise a equipe: todo mundo entra de novo uma vez, pelo link do e-mail.

### Como voltar atrás

- **Voltar o código**: redeploy do commit anterior (`feat/mcp-api-token`) no web, worker e cron. As tabelas do NextAuth (`Account`, `Session`, `VerificationToken`) e a coluna `User.emailVerified` não foram tocadas, então o login antigo volta a funcionar na hora (quem estava logado no NextAuth antes da virada continua logado).
- **O banco pode ficar como está**: o código antigo ignora as colunas e tabelas novas. Não precisa desfazer a migração.
- **Se mesmo assim quiser limpar o banco** (só em último caso, depois de voltar o código): restaure o backup do passo 1, ou apague à mão, nesta ordem, o schema `whatsapp`, o schema `app`, as tabelas `AuthSession`, `AuthAccount`, `AuthVerification`, `TwoFactor`, `BetaAllowlist`, `AdminAccessLog`, as colunas `User.authEmailVerified`, `User.role`, `User.twoFactorEnabled`, o tipo `PlatformRole` e a linha da migração em `_prisma_migrations`.
- **Perdeu o celular do 2FA**: entre com um dos códigos de recuperação. Sem eles: `UPDATE "User" SET "twoFactorEnabled" = false WHERE email = 'SEU_EMAIL'; DELETE FROM "TwoFactor" WHERE "userId" = (SELECT id FROM "User" WHERE email = 'SEU_EMAIL');` e ligue de novo.

---

## 4. Login: regras de segurança

- Não existe cadastro aberto por senha. A senha é criada depois de entrar pelo link ou pelo Google (evita alguém registrar o e-mail de outra pessoa antes dela).
- A allowlist vale nos três caminhos e em **toda sessão nova**: tirou a pessoa da lista, ela não entra mais nem com a senha. Remover em `/admin` também fecha as sessões abertas dela.
- Pedido de link pra e-mail fora da lista responde igual ao de dentro (ninguém descobre quem está na lista), mas nenhum e-mail sai.
- Limites: 5 links por e-mail por hora e 10 tentativas de senha por e-mail a cada 15 minutos (Redis), mais o limite por IP do próprio Better Auth. 2FA trava a conta por 15 minutos depois de 10 códigos errados.
- Admin sem 2FA não usa o painel nem a API pela sessão (só a tela de ligar o 2FA). As chaves de API dele continuam funcionando.
- Senha: mínimo 10 caracteres, guardada só como hash (scrypt). Segredo do 2FA e códigos de recuperação ficam criptografados com o `BETTER_AUTH_SECRET`. **Trocar o `BETTER_AUTH_SECRET` derruba todas as sessões e invalida os 2FA**: não troque sem necessidade.

---

## 5. RLS (segunda tranca no banco)

### Papéis

A migração cria (se quem roda tiver permissão; senão só avisa):

| Papel | Pra quê | RLS |
|---|---|---|
| `le_app` | site e worker agindo em nome de uma pessoa | **filtrado** (sem BYPASSRLS) |
| `le_system` | webhooks, cron, login (ainda não sabem quem é a pessoa) | passa por cima (BYPASSRLS) |
| `le_owner` | dono das tabelas, só migração | |

Eles nascem **sem login** (NOLOGIN). A conexão de hoje (`DATABASE_URL`) ganha o direito de "virar" `le_app` ou `le_system` dentro de uma transação. É assim que o código usa:

- `withRls({ userId, workspaceId }, tx => ...)` e `forUser(...)` (extensão do Prisma) em `lib/db/rls.ts`: cada transação começa com `set_config('app.user_id', ..., true)`, `set_config('app.workspace_id', ..., true)` e `set_config('role', 'le_app', true)`. O `true` faz valer só naquela transação, então funciona com o pool de conexões.
- `withSystemRole(tx => ...)` pra webhook e cron.

Se a migração avisar que não conseguiu criar os papéis, rode como superusuário do Postgres:

```sql
CREATE ROLE le_app NOLOGIN NOBYPASSRLS;
CREATE ROLE le_system NOLOGIN BYPASSRLS;
CREATE ROLE le_owner NOLOGIN;
GRANT le_app, le_system TO <usuario_do_DATABASE_URL>;
-- depois rode de novo os GRANTs do fim da migração 20261013120000.
```

Opcional, pra separar de vez as conexões: dê senha pro `le_app` (`ALTER ROLE le_app LOGIN PASSWORD '...'`), coloque em `DATABASE_URL_APP` e use `DB_RLS_ROLE=off`.

**Importante:** superusuário e dono com BYPASSRLS passam por cima da RLS. Por isso o código troca pro `le_app` em cada transação, em vez de confiar no usuário da conexão.

### Policies desta fase

| Tabela | Quem lê e grava | Admin |
|---|---|---|
| `whatsapp.WaSession` | membro do workspace ativo | lê status e números de todos |
| `whatsapp.WaContact`, `WaConversation`, `WaMessage`, `WaLabel`, `WaConversationLabel` | membro do workspace ativo (a Kayanne vê e responde o inbox do seu workspace) | só lê, e só com um registro em `AdminAccessLog` dele, daquele workspace, dos últimos 15 minutos |
| `public.AdminAccessLog` | só o admin grava (em nome dele) e lê | ninguém edita nem apaga |

"Workspace ativo" é o da sessão ou o da chave de API. Então uma chave de API também só enxerga o workspace onde foi criada, igual ao filtro que o código já faz.

Funções no schema `app`: `current_user_id()`, `current_workspace_id()`, `is_admin()` (lê `User.role` no banco, nunca do navegador), `is_workspace_member()`, `in_current_workspace()`, `my_workspace_ids()` e `admin_audit_ok()`.

Abrir conversa como admin: `openConversationAsAdmin()` em `lib/whatsapp/admin-access.ts` grava o log e lê na mesma transação.

### Tabelas antigas: plano (não ligado nesta fase)

A RLS **não** foi ligada nas tabelas antigas (`Contact`, `Automation`, `DmLog`, `Funnel` e o resto). Motivo: o worker, o cron e os webhooks da Meta e da Hotmart leem e gravam nelas sem saber de quem é o evento, e o site usa o cliente Prisma sem contexto em mais de 100 rotas. Ligar agora derrubaria o envio de DM e os quizzes. O filtro por `workspaceId` no código continua valendo, como sempre.

Ordem pra próxima fase, uma tabela por vez:

1. Trocar as rotas daquela tabela pra `withRls()` (ou `forUser()`), com o `workspaceId` de `getCurrentWorkspaceContext()`.
2. Trocar worker, cron e webhooks que tocam nela pra `withSystemRole()` (ou `withRls()` com o dono do evento, quando já se sabe quem é).
3. Ligar a RLS só daquela tabela:
   ```sql
   ALTER TABLE public."Contact" ENABLE ROW LEVEL SECURITY;
   ALTER TABLE public."Contact" FORCE ROW LEVEL SECURITY;
   CREATE POLICY ws_member ON public."Contact" FOR ALL TO PUBLIC
     USING ("workspaceId" IN (SELECT app.my_workspace_ids()) OR app.is_admin())
     WITH CHECK ("workspaceId" IN (SELECT app.my_workspace_ids()));
   GRANT SELECT, INSERT, UPDATE, DELETE ON public."Contact" TO le_app, le_system;
   ```
4. Rodar os testes e observar um dia antes da próxima.

Sugestão de ordem: `ContactTag`, `ContactEvent`, `Contact`, `DraftReply`, `Segment`, `Broadcast*`, `Flow*`, `Funnel*`, `Automation`, `DmLog`, `InstagramAccount` (por último, porque o webhook e o worker dependem dela o tempo todo). `WorkspaceMember` e `User` ficam sem RLS (as funções `SECURITY DEFINER` dependem delas).

---

## 6. Testes

- `__tests__/multiusuario-login.test.ts`: link, senha e Google (simulado), allowlist, 2FA nos três caminhos, códigos de recuperação.
- `__tests__/multiusuario-rls.test.ts`: Postgres de verdade (PGlite) com todas as migrações. A não lê B, Kayanne vê o workspace do dono, admin só com auditoria, log não se apaga.
- `__tests__/multiusuario-migracao.test.ts`: script de dados idempotente e, depois dele, o dono entra pelo login novo no mesmo usuário, com workspace, chave de API e convites.
- `__tests__/multiusuario-allowlist.test.ts` e `__tests__/auditoria-2026-10-05.test.ts`: allowlist, cookie novo no proxy, admin sem 2FA bloqueado, chave de API presa ao workspace.
