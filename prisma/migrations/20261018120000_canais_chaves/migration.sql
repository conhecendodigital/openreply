-- Canais > Conexões e chaves (06/10/2026). Pedido do dono: "preciso que as
-- apis e conexões fiquem tudo em canais para colocar as chaves".
--
-- SÓ ADITIVA: duas tabelas novas e uma função nova. Nada existente muda.
--
-- WorkspaceIntegrationCredential: um valor por (workspace, serviço, campo),
--   cifrado com AES-256-GCM (ENCRYPTION_KEY, igual aos tokens da Meta). Só os
--   4 últimos caracteres saem. Serviços: uazapi (serverUrl, adminToken,
--   maxInstances) e openwa (baseUrl, apiKey).
-- WorkspaceIntegrationAudit: quem salvou, trocou, removeu ou testou, e quando.
--   Nunca o valor.
--
-- Precedência no código (lib/integrations/credentials.ts): valor salvo aqui >
-- variável de ambiente > não configurado.

CREATE TABLE "WorkspaceIntegrationCredential" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "valueEnc" TEXT NOT NULL,
    "last4" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceIntegrationCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceIntegrationAudit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "field" TEXT,
    "action" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceIntegrationAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceIntegrationCredential_workspaceId_service_field_key"
  ON "WorkspaceIntegrationCredential"("workspaceId", "service", "field");
CREATE INDEX "WorkspaceIntegrationAudit_workspaceId_createdAt_idx"
  ON "WorkspaceIntegrationAudit"("workspaceId", "createdAt");

ALTER TABLE "WorkspaceIntegrationCredential" ADD CONSTRAINT "WorkspaceIntegrationCredential_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceIntegrationAudit" ADD CONSTRAINT "WorkspaceIntegrationAudit_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Só os serviços e campos que o código conhece.
ALTER TABLE "WorkspaceIntegrationCredential" ADD CONSTRAINT "WorkspaceIntegrationCredential_field_check"
  CHECK (("service" = 'uazapi' AND "field" IN ('serverUrl', 'adminToken', 'maxInstances'))
      OR ("service" = 'openwa' AND "field" IN ('baseUrl', 'apiKey')));
ALTER TABLE "WorkspaceIntegrationAudit" ADD CONSTRAINT "WorkspaceIntegrationAudit_action_check"
  CHECK ("action" IN ('saved', 'replaced', 'removed', 'tested'));

-- ===========================================================================
-- RLS (padrão da Fase 0)
--   Chaves: só dono ou admin do workspace ATIVO lê e grava (papel le_app).
--   Membro comum não vê nem o valor cifrado. Os workers leem pelo le_system
--   (BYPASSRLS), só no servidor.
--   Auditoria: dono/admin do workspace lê e inclui (em nome dele); o admin da
--   plataforma lê. Ninguém edita nem apaga.
-- ===========================================================================

-- Dono ou admin do workspace (o papel vem do banco, nunca do navegador).
CREATE OR REPLACE FUNCTION app.is_workspace_manager(ws text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public."WorkspaceMember"
    WHERE "workspaceId" = ws AND "userId" = app.current_user_id()
      AND role::text IN ('OWNER', 'ADMIN')
  )
$$;

ALTER TABLE public."WorkspaceIntegrationCredential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WorkspaceIntegrationCredential" FORCE ROW LEVEL SECURITY;
CREATE POLICY ws_manager ON public."WorkspaceIntegrationCredential" FOR ALL TO PUBLIC
  USING (app.in_current_workspace("workspaceId") AND app.is_workspace_manager("workspaceId"))
  WITH CHECK (app.in_current_workspace("workspaceId") AND app.is_workspace_manager("workspaceId"));

ALTER TABLE public."WorkspaceIntegrationAudit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."WorkspaceIntegrationAudit" FORCE ROW LEVEL SECURITY;
CREATE POLICY ws_manager_read ON public."WorkspaceIntegrationAudit" FOR SELECT TO PUBLIC
  USING ((app.in_current_workspace("workspaceId") AND app.is_workspace_manager("workspaceId")) OR app.is_admin());
CREATE POLICY ws_manager_insert ON public."WorkspaceIntegrationAudit" FOR INSERT TO PUBLIC
  WITH CHECK (app.in_current_workspace("workspaceId") AND app.is_workspace_manager("workspaceId")
              AND "actorUserId" = app.current_user_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_app') THEN
    GRANT EXECUTE ON FUNCTION app.is_workspace_manager(text) TO le_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public."WorkspaceIntegrationCredential" TO le_app;
    GRANT SELECT, INSERT ON public."WorkspaceIntegrationAudit" TO le_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_system') THEN
    GRANT EXECUTE ON FUNCTION app.is_workspace_manager(text) TO le_system;
    GRANT SELECT ON public."WorkspaceIntegrationCredential" TO le_system;
    GRANT SELECT ON public."WorkspaceIntegrationAudit" TO le_system;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'não deu pra dar as permissões das chaves de integração, veja docs/canais-chaves.md';
END $$;
