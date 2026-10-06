-- Fase 0 (06/10/2026): login novo (Better Auth), admin da plataforma, allowlist do
-- beta, log de auditoria do admin e o schema "whatsapp" com RLS.
-- SÓ ADITIVA: nenhuma tabela ou coluna antiga é apagada ou alterada. As tabelas do
-- NextAuth (Account, Session, VerificationToken) ficam intactas pra dar pra voltar
-- atrás só com redeploy. Passo a passo em docs/fase0-multiusuario.md.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "whatsapp";

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "whatsapp"."WaProvider" AS ENUM ('OPENWA', 'CLOUD_API');

-- CreateEnum
CREATE TYPE "whatsapp"."WaStatus" AS ENUM ('PENDING', 'QR_READY', 'CONNECTED', 'DISCONNECTED', 'RESTRICTED', 'BANNED');

-- CreateEnum
CREATE TYPE "whatsapp"."WaAgentMode" AS ENUM ('INHERIT', 'OFF', 'DRAFT', 'AUTO');

-- CreateEnum
CREATE TYPE "whatsapp"."WaSentBy" AS ENUM ('CONTACT', 'USER_APP', 'USER_PHONE', 'AGENT');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "authEmailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "role" "PlatformRole" NOT NULL DEFAULT 'USER',
ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthVerification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwoFactor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT true,
    "failedVerificationCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "TwoFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BetaAllowlist" (
    "email" TEXT NOT NULL,
    "canWhatsapp" BOOLEAN NOT NULL DEFAULT true,
    "addedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BetaAllowlist_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "AdminAccessLog" (
    "id" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "targetWorkspaceId" TEXT NOT NULL,
    "targetUserId" TEXT,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp"."WaSession" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "provider" "whatsapp"."WaProvider" NOT NULL,
    "providerSessionId" TEXT NOT NULL,
    "phoneE164" TEXT,
    "displayName" TEXT,
    "status" "whatsapp"."WaStatus" NOT NULL DEFAULT 'PENDING',
    "webhookSecretEnc" TEXT,
    "agentMode" "whatsapp"."WaAgentMode" NOT NULL DEFAULT 'OFF',
    "riskAcceptedAt" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3),
    "conversationCount" INTEGER NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp"."WaContact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "jid" TEXT NOT NULL,
    "phoneE164" TEXT,
    "name" TEXT,
    "pushName" TEXT,
    "avatarUrl" TEXT,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "crmContactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp"."WaConversation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "lastMessagePreview" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "pinnedAt" TIMESTAMP(3),
    "mutedUntil" TIMESTAMP(3),
    "agentMode" "whatsapp"."WaAgentMode" NOT NULL DEFAULT 'INHERIT',
    "humanTakeoverUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp"."WaMessage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "providerMessageId" TEXT NOT NULL,
    "fromMe" BOOLEAN NOT NULL,
    "sentBy" "whatsapp"."WaSentBy" NOT NULL,
    "type" TEXT NOT NULL,
    "body" TEXT,
    "quotedId" TEXT,
    "ack" TEXT NOT NULL DEFAULT 'pending',
    "sentAt" TIMESTAMP(3) NOT NULL,
    "editedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp"."WaLabel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "agentMode" "whatsapp"."WaAgentMode" NOT NULL DEFAULT 'INHERIT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp"."WaConversationLabel" (
    "conversationId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaConversationLabel_pkey" PRIMARY KEY ("conversationId","labelId")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_token_key" ON "AuthSession"("token");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE INDEX "AuthAccount_userId_idx" ON "AuthAccount"("userId");

-- CreateIndex
CREATE INDEX "AuthAccount_providerId_accountId_idx" ON "AuthAccount"("providerId", "accountId");

-- CreateIndex
CREATE INDEX "AuthVerification_identifier_idx" ON "AuthVerification"("identifier");

-- CreateIndex
CREATE INDEX "TwoFactor_userId_idx" ON "TwoFactor"("userId");

-- CreateIndex
CREATE INDEX "TwoFactor_secret_idx" ON "TwoFactor"("secret");

-- CreateIndex
CREATE INDEX "AdminAccessLog_adminUserId_createdAt_idx" ON "AdminAccessLog"("adminUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAccessLog_targetWorkspaceId_createdAt_idx" ON "AdminAccessLog"("targetWorkspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WaSession_providerSessionId_key" ON "whatsapp"."WaSession"("providerSessionId");

-- CreateIndex
CREATE INDEX "WaSession_workspaceId_idx" ON "whatsapp"."WaSession"("workspaceId");

-- CreateIndex
CREATE INDEX "WaSession_ownerUserId_idx" ON "whatsapp"."WaSession"("ownerUserId");

-- CreateIndex
CREATE INDEX "WaContact_workspaceId_name_idx" ON "whatsapp"."WaContact"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "WaContact_sessionId_jid_key" ON "whatsapp"."WaContact"("sessionId", "jid");

-- CreateIndex
CREATE INDEX "WaConversation_workspaceId_archivedAt_pinnedAt_lastMessageA_idx" ON "whatsapp"."WaConversation"("workspaceId", "archivedAt", "pinnedAt" DESC, "lastMessageAt" DESC);

-- CreateIndex
CREATE INDEX "WaConversation_workspaceId_unreadCount_idx" ON "whatsapp"."WaConversation"("workspaceId", "unreadCount");

-- CreateIndex
CREATE UNIQUE INDEX "WaConversation_sessionId_contactId_key" ON "whatsapp"."WaConversation"("sessionId", "contactId");

-- CreateIndex
CREATE INDEX "WaMessage_conversationId_sentAt_idx" ON "whatsapp"."WaMessage"("conversationId", "sentAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "WaMessage_sessionId_providerMessageId_key" ON "whatsapp"."WaMessage"("sessionId", "providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "WaLabel_workspaceId_name_key" ON "whatsapp"."WaLabel"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "WaConversationLabel_workspaceId_labelId_idx" ON "whatsapp"."WaConversationLabel"("workspaceId", "labelId");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthAccount" ADD CONSTRAINT "AuthAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TwoFactor" ADD CONSTRAINT "TwoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."WaSession" ADD CONSTRAINT "WaSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."WaSession" ADD CONSTRAINT "WaSession_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."WaContact" ADD CONSTRAINT "WaContact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."WaContact" ADD CONSTRAINT "WaContact_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "whatsapp"."WaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."WaConversation" ADD CONSTRAINT "WaConversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."WaConversation" ADD CONSTRAINT "WaConversation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "whatsapp"."WaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."WaConversation" ADD CONSTRAINT "WaConversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "whatsapp"."WaContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."WaMessage" ADD CONSTRAINT "WaMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."WaMessage" ADD CONSTRAINT "WaMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "whatsapp"."WaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."WaMessage" ADD CONSTRAINT "WaMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "whatsapp"."WaConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."WaLabel" ADD CONSTRAINT "WaLabel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."WaConversationLabel" ADD CONSTRAINT "WaConversationLabel_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "whatsapp"."WaConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp"."WaConversationLabel" ADD CONSTRAINT "WaConversationLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "whatsapp"."WaLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- Fase 0: RLS (segunda tranca, além do filtro por workspaceId no código).
--
-- Papéis (NOLOGIN aqui; quem dá senha/LOGIN é o dono do banco, veja
-- docs/fase0-multiusuario.md):
--   le_app    = site e worker agindo em nome de uma pessoa. Sem BYPASSRLS.
--   le_system = webhooks, cron e login (ainda não sabem quem é a pessoa). BYPASSRLS.
--   le_owner  = dono das tabelas, só roda migração.
-- Se quem roda a migração não puder criar papel, ela segue (só avisa): as
-- policies valem pra PUBLIC, então qualquer conexão sem BYPASSRLS já é filtrada.
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_app') THEN
    CREATE ROLE le_app NOLOGIN NOBYPASSRLS;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'sem permissão pra criar o papel le_app (crie à mão, veja docs/fase0-multiusuario.md)';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_system') THEN
    CREATE ROLE le_system NOLOGIN BYPASSRLS;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'sem permissão pra criar o papel le_system (crie à mão, veja docs/fase0-multiusuario.md)';
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_owner') THEN
    CREATE ROLE le_owner NOLOGIN;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'sem permissão pra criar o papel le_owner (crie à mão, veja docs/fase0-multiusuario.md)';
END $$;

-- Quem conecta hoje (DATABASE_URL) pode virar le_app/le_system dentro de uma
-- transação (SET LOCAL ROLE), sem precisar de outra conexão.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_app') THEN
    EXECUTE format('GRANT le_app TO %I', current_user);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_system') THEN
    EXECUTE format('GRANT le_system TO %I', current_user);
  END IF;
EXCEPTION WHEN insufficient_privilege OR invalid_grant_operation THEN
  RAISE NOTICE 'não deu pra ligar os papéis a %, veja docs/fase0-multiusuario.md', current_user;
END $$;

CREATE SCHEMA IF NOT EXISTS app;

-- Quem é a pessoa desta transação (set_config(..., true) vale só na transação).
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')
$$;

-- Workspace ativo desta transação (o da sessão, ou o da chave de API).
CREATE OR REPLACE FUNCTION app.current_workspace_id() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.workspace_id', true), '')
$$;

-- Admin vem do banco, nunca de algo que o navegador mande.
CREATE OR REPLACE FUNCTION app.is_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."User"
    WHERE id = app.current_user_id() AND role = 'ADMIN'
  )
$$;

CREATE OR REPLACE FUNCTION app.is_workspace_member(ws text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."WorkspaceMember"
    WHERE "workspaceId" = ws AND "userId" = app.current_user_id()
  )
$$;

-- Linha do workspace ativo E a pessoa é membro dele (Kayanne vê o inbox do
-- workspace do Matheus; uma chave de API só vê o workspace onde foi criada).
CREATE OR REPLACE FUNCTION app.in_current_workspace(ws text) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT ws IS NOT NULL
     AND ws = app.current_workspace_id()
     AND app.is_workspace_member(ws)
$$;

-- Workspaces da pessoa (pras tabelas antigas, quando a RLS chegar nelas).
CREATE OR REPLACE FUNCTION app.my_workspace_ids() RETURNS SETOF text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT "workspaceId" FROM public."WorkspaceMember" WHERE "userId" = app.current_user_id()
$$;

-- Admin só lê conteúdo de outro workspace com um registro de auditoria dele,
-- desse workspace, criado nos últimos 15 minutos e marcado nesta transação
-- (app.admin_access_id).
CREATE OR REPLACE FUNCTION app.admin_audit_ok(ws text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT app.is_admin() AND EXISTS (
    SELECT 1 FROM public."AdminAccessLog" l
    WHERE l.id = nullif(current_setting('app.admin_access_id', true), '')
      AND l."adminUserId" = app.current_user_id()
      AND l."targetWorkspaceId" = ws
      AND l."createdAt" > now() - interval '15 minutes'
  )
$$;

-- Tabelas de conteúdo do WhatsApp: membro do workspace ativo faz tudo; admin
-- só lê, e só com auditoria.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['WaContact','WaConversation','WaMessage','WaLabel','WaConversationLabel']
  LOOP
    EXECUTE format('ALTER TABLE whatsapp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE whatsapp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY ws_member ON whatsapp.%I FOR ALL TO PUBLIC
      USING (app.in_current_workspace("workspaceId"))
      WITH CHECK (app.in_current_workspace("workspaceId"))
    $p$, t);
    EXECUTE format($p$
      CREATE POLICY admin_audited_read ON whatsapp.%I FOR SELECT TO PUBLIC
      USING (app.admin_audit_ok("workspaceId"))
    $p$, t);
  END LOOP;
END $$;

-- Números conectados: membro faz tudo; admin vê status e números de todos.
ALTER TABLE whatsapp."WaSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp."WaSession" FORCE ROW LEVEL SECURITY;
CREATE POLICY ws_member ON whatsapp."WaSession" FOR ALL TO PUBLIC
  USING (app.in_current_workspace("workspaceId"))
  WITH CHECK (app.in_current_workspace("workspaceId"));
CREATE POLICY admin_read_status ON whatsapp."WaSession" FOR SELECT TO PUBLIC
  USING (app.is_admin());

-- Log de auditoria: só o admin grava (em nome dele) e lê. Ninguém edita nem apaga.
ALTER TABLE public."AdminAccessLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."AdminAccessLog" FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_insert ON public."AdminAccessLog" FOR INSERT TO PUBLIC
  WITH CHECK (app.is_admin() AND "adminUserId" = app.current_user_id());
CREATE POLICY admin_select ON public."AdminAccessLog" FOR SELECT TO PUBLIC
  USING (app.is_admin());

-- Permissões dos papéis (só se eles existirem).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_app') THEN
    GRANT USAGE ON SCHEMA app TO le_app;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO le_app;
    GRANT USAGE ON SCHEMA whatsapp TO le_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA whatsapp TO le_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA whatsapp GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO le_app;
    GRANT USAGE ON SCHEMA public TO le_app;
    GRANT SELECT, INSERT ON public."AdminAccessLog" TO le_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_system') THEN
    GRANT USAGE ON SCHEMA app TO le_system;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO le_system;
    GRANT USAGE ON SCHEMA whatsapp TO le_system;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA whatsapp TO le_system;
    ALTER DEFAULT PRIVILEGES IN SCHEMA whatsapp GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO le_system;
    GRANT USAGE ON SCHEMA public TO le_system;
    GRANT SELECT, INSERT ON public."AdminAccessLog" TO le_system;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'não deu pra dar as permissões dos papéis, veja docs/fase0-multiusuario.md';
END $$;
