-- WhatsApp > Conexões: "Excluir número" (pedido do dono, 06/10/2026: "ter a
-- opção de excluir o número nas conexões").
--
-- Desconectar continua sem apagar nada. Excluir é uma ação separada, com
-- confirmação, e tem duas opções:
--   1. só o número: o WaSession fica com deletedAt (some de Conexões; as
--      conversas ficam só pra leitura em Conversas);
--   2. número e conversas: o WaSession é apagado (cascata em contatos,
--      conversas, mensagens, rascunhos e memória do agente daquele número).
--
-- SÓ ADITIVA: nenhuma tabela ou coluna existente é apagada ou mudada de tipo.
-- Colunas novas são opcionais (NULL).
-- RLS: WaSession já tem RLS forçada desde a Fase 0. A tabela nova de auditoria
-- (WaNumberDeletion) só aceita INSERT e SELECT de quem é do workspace ativo
-- (e SELECT do admin). Sem policy de UPDATE ou DELETE: ninguém edita nem apaga.

DO $$
BEGIN
  IF to_regprocedure('app.in_current_workspace(text)') IS NULL OR to_regprocedure('app.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'Funções app.in_current_workspace / app.is_admin não existem: rode a migração da Fase 0 antes';
  END IF;
  IF to_regclass('whatsapp."WaSession"') IS NULL THEN
    RAISE EXCEPTION 'Faltam as tabelas whatsapp da Fase 0 (20261013120000_multiusuario_login_whatsapp)';
  END IF;
END $$;

-- 1. Número excluído (opção 1): quando e por quem.
ALTER TABLE whatsapp."WaSession" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE whatsapp."WaSession" ADD COLUMN IF NOT EXISTS "deletedById" TEXT;

-- 2. Auditoria (sem conteúdo de mensagem).
CREATE TABLE IF NOT EXISTS whatsapp."WaNumberDeletion" (
  "id"                   TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "workspaceId"          TEXT NOT NULL,
  "sessionId"            TEXT NOT NULL,
  "deletedById"          TEXT NOT NULL,
  -- number_only | number_and_conversations | conversations_after
  "mode"                 TEXT NOT NULL,
  "provider"             whatsapp."WaProvider" NOT NULL,
  "providerSessionId"    TEXT NOT NULL,
  "label"                TEXT,
  "providerOk"           BOOLEAN NOT NULL,
  "conversationsDeleted" INTEGER NOT NULL DEFAULT 0,
  "messagesDeleted"      INTEGER NOT NULL DEFAULT 0,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaNumberDeletion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WaNumberDeletion_workspaceId_createdAt_idx"
  ON whatsapp."WaNumberDeletion" ("workspaceId", "createdAt" DESC);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WaNumberDeletion_workspaceId_fkey') THEN
    ALTER TABLE whatsapp."WaNumberDeletion" ADD CONSTRAINT "WaNumberDeletion_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES public."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 3. RLS da auditoria.
ALTER TABLE whatsapp."WaNumberDeletion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp."WaNumberDeletion" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_read ON whatsapp."WaNumberDeletion";
DROP POLICY IF EXISTS ws_insert ON whatsapp."WaNumberDeletion";
DROP POLICY IF EXISTS admin_read ON whatsapp."WaNumberDeletion";
CREATE POLICY ws_read ON whatsapp."WaNumberDeletion" FOR SELECT TO PUBLIC
  USING (app.in_current_workspace("workspaceId"));
CREATE POLICY ws_insert ON whatsapp."WaNumberDeletion" FOR INSERT TO PUBLIC
  WITH CHECK (app.in_current_workspace("workspaceId") AND "deletedById" = app.current_user_id());
CREATE POLICY admin_read ON whatsapp."WaNumberDeletion" FOR SELECT TO PUBLIC
  USING (app.is_admin());

-- 4. Permissões (só se os papéis existirem; mesmo padrão da Fase 0).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_app') THEN
    GRANT SELECT, INSERT ON whatsapp."WaNumberDeletion" TO le_app;
    REVOKE UPDATE, DELETE ON whatsapp."WaNumberDeletion" FROM le_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_system') THEN
    GRANT SELECT, INSERT ON whatsapp."WaNumberDeletion" TO le_system;
    REVOKE UPDATE, DELETE ON whatsapp."WaNumberDeletion" FROM le_system;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'não deu pra dar as permissões da auditoria de exclusão, veja docs/whatsapp-uazapi.md';
END $$;
