-- Revisão do app pela Meta (06/10/2026): callbacks de exclusão de dados e de
-- desautorização. Só ADICIONA: nada é apagado nem alterado.
--
-- InstagramAccount.appScopedId: o `id` do /me (id do app). É ele que chega no
--   user_id do signed_request. Opcional e sem índice único, pra não quebrar
--   nenhuma conta que já existe (as antigas ganham o valor quando reconectam).
-- DataDeletionRequest: um pedido de exclusão por chamada da Meta, com o código
--   de confirmação que a página pública de status mostra.

-- AlterTable
ALTER TABLE "InstagramAccount" ADD COLUMN "appScopedId" TEXT;

-- CreateIndex
CREATE INDEX "InstagramAccount_appScopedId_idx" ON "InstagramAccount"("appScopedId");

-- CreateTable
CREATE TABLE "DataDeletionRequest" (
    "id" TEXT NOT NULL,
    "confirmationCode" TEXT NOT NULL,
    "metaUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "instagramAccountId" TEXT,
    "workspaceId" TEXT,
    "deleted" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DataDeletionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DataDeletionRequest_confirmationCode_key" ON "DataDeletionRequest"("confirmationCode");

-- CreateIndex
CREATE INDEX "DataDeletionRequest_metaUserId_idx" ON "DataDeletionRequest"("metaUserId");

-- CreateIndex
CREATE INDEX "DataDeletionRequest_createdAt_idx" ON "DataDeletionRequest"("createdAt");

-- Status conhecido.
ALTER TABLE "DataDeletionRequest" ADD CONSTRAINT "DataDeletionRequest_status_check"
  CHECK ("status" IN ('RECEIVED', 'COMPLETED', 'NOT_FOUND', 'AMBIGUOUS', 'FAILED'));

-- ===========================================================================
-- RLS (tabela de sistema, igual PlatformAiCredential)
--   Quem grava é o callback da Meta pelo le_system (BYPASSRLS), só no
--   servidor. A página pública de status lê pelo le_system só o status de um
--   código. Pelo le_app só o admin lê; ninguém grava, edita nem apaga.
-- ===========================================================================

ALTER TABLE public."DataDeletionRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DataDeletionRequest" FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_read ON public."DataDeletionRequest" FOR SELECT TO PUBLIC
  USING (app.is_admin());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_app') THEN
    GRANT SELECT ON public."DataDeletionRequest" TO le_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_system') THEN
    GRANT SELECT, INSERT, UPDATE ON public."DataDeletionRequest" TO le_system;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'não deu pra dar as permissões de DataDeletionRequest, veja docs/fase0-multiusuario.md';
END $$;
