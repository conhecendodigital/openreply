-- Chaves de IA da plataforma e gasto de IA (06/10/2026).
-- Pedido do dono: "as API quero colocar a chave no admin" e "relatório de
-- gasto das APIs e de clientes". Só ADICIONA: nada é apagado nem alterado.
--
-- PlatformAiCredential: uma chave por provedor (AES-256-GCM, só keyLast4 sai).
-- PlatformAiSettings:   modelo por agente, tetos diários, preços e cotação.
-- whatsapp.WaAiUsage:   uma linha por chamada paga (mesmos nomes da tabela do
--                       branch feat/wa-cerebro, mais as colunas do relatório).

-- CreateTable
CREATE TABLE "PlatformAiCredential" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "keyEnc" TEXT NOT NULL,
    "keyLast4" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAiCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAiSettings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "agentModels" JSONB,
    "prices" JSONB,
    "dailyCapUserUsd" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "dailyCapWorkspaceUsd" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "usdToBrl" DOUBLE PRECISION,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformAiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp"."WaAiUsage" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "ownerUserId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "agent" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "contactId" TEXT,
    "conversationId" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "cacheRead" INTEGER NOT NULL DEFAULT 0,
    "cacheWrite" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" BIGINT NOT NULL DEFAULT 0,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "refId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaAiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAiCredential_provider_key" ON "PlatformAiCredential"("provider");

-- CreateIndex
CREATE INDEX "WaAiUsage_owner_created_idx" ON "whatsapp"."WaAiUsage"("ownerUserId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WaAiUsage_workspaceId_createdAt_idx" ON "whatsapp"."WaAiUsage"("workspaceId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "WaAiUsage_createdAt_idx" ON "whatsapp"."WaAiUsage"("createdAt");

-- AddForeignKey
ALTER TABLE "whatsapp"."WaAiUsage" ADD CONSTRAINT "WaAiUsage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Provedor conhecido (a tela e o código só aceitam esses três).
ALTER TABLE "PlatformAiCredential" ADD CONSTRAINT "PlatformAiCredential_provider_check"
  CHECK ("provider" IN ('anthropic', 'openai', 'typesafe'));
-- Linha única de configurações.
ALTER TABLE "PlatformAiSettings" ADD CONSTRAINT "PlatformAiSettings_singleton_check"
  CHECK ("id" = 'global');

-- ===========================================================================
-- RLS
--   Chaves e configurações: só o admin lê e grava (papel le_app com
--   app.is_admin()). Os agentes leem pelo le_system (BYPASSRLS), só no servidor.
--   Gasto: cada usuário lê só as linhas dele; o admin lê todas. Ninguém edita
--   nem apaga pelo le_app (sem UPDATE/DELETE).
-- ===========================================================================

ALTER TABLE public."PlatformAiCredential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PlatformAiCredential" FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_only ON public."PlatformAiCredential" FOR ALL TO PUBLIC
  USING (app.is_admin())
  WITH CHECK (app.is_admin());

ALTER TABLE public."PlatformAiSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."PlatformAiSettings" FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_only ON public."PlatformAiSettings" FOR ALL TO PUBLIC
  USING (app.is_admin())
  WITH CHECK (app.is_admin());

ALTER TABLE whatsapp."WaAiUsage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp."WaAiUsage" FORCE ROW LEVEL SECURITY;
CREATE POLICY own_or_admin_read ON whatsapp."WaAiUsage" FOR SELECT TO PUBLIC
  USING ("ownerUserId" = app.current_user_id() OR app.is_admin());
CREATE POLICY own_or_admin_insert ON whatsapp."WaAiUsage" FOR INSERT TO PUBLIC
  WITH CHECK ("ownerUserId" = app.current_user_id() OR app.is_admin());

-- Permissões dos papéis (só se eles existirem). O ALTER DEFAULT PRIVILEGES da
-- fase 0 dá UPDATE/DELETE no schema whatsapp: aqui o gasto fica só leitura e
-- inclusão.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public."PlatformAiCredential" TO le_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public."PlatformAiSettings" TO le_app;
    REVOKE UPDATE, DELETE ON whatsapp."WaAiUsage" FROM le_app;
    GRANT SELECT, INSERT ON whatsapp."WaAiUsage" TO le_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_system') THEN
    GRANT SELECT ON public."PlatformAiCredential" TO le_system;
    GRANT SELECT ON public."PlatformAiSettings" TO le_system;
    REVOKE UPDATE, DELETE ON whatsapp."WaAiUsage" FROM le_system;
    GRANT SELECT, INSERT ON whatsapp."WaAiUsage" TO le_system;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'não deu pra dar as permissões das tabelas de IA, veja docs/ia-chaves-e-gastos.md';
END $$;
