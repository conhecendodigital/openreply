-- WhatsApp: textos programados por conversa (pedido do dono, 08/10/2026:
-- "enviar todo dia 10 pra mim, 6 da manhã de Brasília"). O cron
-- /api/cron/whatsapp-programados enfileira até 10 por conversa por dia.
--
-- SÓ ADITIVA: uma tabela nova. RLS no padrão das tabelas whatsapp.*
-- (membro do workspace ativo; admin só lê com auditoria).

DO $$
BEGIN
  IF to_regprocedure('app.in_current_workspace(text)') IS NULL OR to_regprocedure('app.admin_audit_ok(text)') IS NULL THEN
    RAISE EXCEPTION 'Funções app.in_current_workspace / app.admin_audit_ok não existem: rode a migração da Fase 0 antes';
  END IF;
  IF to_regclass('whatsapp."WaConversation"') IS NULL THEN
    RAISE EXCEPTION 'Falta a tabela whatsapp."WaConversation"';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS whatsapp."WaScheduledText" (
  "id"             TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "workspaceId"    TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "label"          TEXT NOT NULL CHECK (length("label") BETWEEN 1 AND 80),
  "text"           TEXT NOT NULL CHECK (length("text") BETWEEN 1 AND 4000),
  "position"       INTEGER NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'QUEUED', 'REMOVED')),
  "queuedAt"       TIMESTAMP(3),
  "createdBy"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaScheduledText_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WaScheduledText_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES public."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WaScheduledText_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES whatsapp."WaConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "WaScheduledText_conversationId_label_key" ON whatsapp."WaScheduledText" ("conversationId", "label");
CREATE INDEX IF NOT EXISTS "WaScheduledText_workspaceId_status_position_idx" ON whatsapp."WaScheduledText" ("workspaceId", "status", "position");
CREATE INDEX IF NOT EXISTS "WaScheduledText_conversationId_status_position_idx" ON whatsapp."WaScheduledText" ("conversationId", "status", "position");

ALTER TABLE whatsapp."WaScheduledText" ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp."WaScheduledText" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_member ON whatsapp."WaScheduledText";
DROP POLICY IF EXISTS admin_audited_read ON whatsapp."WaScheduledText";
CREATE POLICY ws_member ON whatsapp."WaScheduledText" FOR ALL TO PUBLIC
  USING (app.in_current_workspace("workspaceId"))
  WITH CHECK (app.in_current_workspace("workspaceId"));
CREATE POLICY admin_audited_read ON whatsapp."WaScheduledText" FOR SELECT TO PUBLIC
  USING (app.admin_audit_ok("workspaceId"));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_app') THEN
    GRANT SELECT, INSERT, UPDATE ON whatsapp."WaScheduledText" TO le_app;
    REVOKE DELETE ON whatsapp."WaScheduledText" FROM le_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_system') THEN
    GRANT SELECT, INSERT, UPDATE ON whatsapp."WaScheduledText" TO le_system;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'não deu pra dar as permissões dos textos programados, veja docs/whatsapp-agentes.md';
END $$;
