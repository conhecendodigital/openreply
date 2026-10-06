-- WhatsApp, fase 1: conector (gateway OpenWA e Cloud API), webhook e envios.
-- Junta o que era prisma/migrations-wa/0001_conector com as tabelas que a
-- Fase 0 não criou (revisão de 06/10): WaWebhookEvent e WaSendBlock, mais as
-- colunas de mídia e de agente em WaMessage.
--
-- SÓ ADITIVA: nenhuma tabela ou coluna existente é apagada ou mudada de tipo.
-- Colunas novas em tabela antiga são todas opcionais (NULL).
-- RLS no mesmo padrão da Fase 0 (app.in_current_workspace; admin só lê com
-- auditoria). WaWebhookEvent não tem policy pra ninguém: só o papel de sistema
-- (le_system, BYPASSRLS) lê e grava o evento cru.

DO $$
BEGIN
  IF to_regprocedure('app.in_current_workspace(text)') IS NULL OR to_regprocedure('app.admin_audit_ok(text)') IS NULL THEN
    RAISE EXCEPTION 'Funções app.in_current_workspace / app.admin_audit_ok não existem: rode a migração da Fase 0 antes';
  END IF;
  IF to_regclass('whatsapp."WaSession"') IS NULL OR to_regclass('whatsapp."WaMessage"') IS NULL THEN
    RAISE EXCEPTION 'Faltam as tabelas whatsapp da Fase 0 (20261013120000_multiusuario_login_whatsapp)';
  END IF;
END $$;

-- 1. Cloud API (coexistência): WABA do número e token de negócio cifrado
--    (AES-256-GCM, encryptToken de lib/meta/oauth.ts). OpenWA não usa.
ALTER TABLE whatsapp."WaSession" ADD COLUMN IF NOT EXISTS "wabaId" TEXT;
ALTER TABLE whatsapp."WaSession" ADD COLUMN IF NOT EXISTS "accessTokenEnc" TEXT;

-- 2. Mensagem: qual run do agente mandou e os dados da mídia (os bytes ficam no
--    gateway; o inbox busca na hora por /api/whatsapp/media/<id>).
ALTER TABLE whatsapp."WaMessage" ADD COLUMN IF NOT EXISTS "agentRunId" TEXT;
ALTER TABLE whatsapp."WaMessage" ADD COLUMN IF NOT EXISTS "mediaMime" TEXT;
ALTER TABLE whatsapp."WaMessage" ADD COLUMN IF NOT EXISTS "mediaFilename" TEXT;
ALTER TABLE whatsapp."WaMessage" ADD COLUMN IF NOT EXISTS "mediaRef" TEXT;

-- Regra das 24h: achar rápido a última mensagem do contato numa conversa.
CREATE INDEX IF NOT EXISTS "WaMessage_conversationId_sentBy_sentAt_idx"
  ON whatsapp."WaMessage" ("conversationId", "sentBy", "sentAt" DESC);

-- 3. Evento cru do webhook (idempotência e reprocessamento). O worker apaga o
--    que passar de 30 dias (lib/whatsapp/retencao.ts).
CREATE TABLE IF NOT EXISTS whatsapp."WaWebhookEvent" (
  "id"          TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "sessionId"   TEXT,
  "ownerUserId" TEXT,
  "provider"    whatsapp."WaProvider" NOT NULL,
  "eventType"   TEXT NOT NULL,
  "dedupeKey"   TEXT NOT NULL,
  "payload"     JSONB NOT NULL,
  -- received | queued
  "status"      TEXT NOT NULL DEFAULT 'received',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaWebhookEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WaWebhookEvent_dedupeKey_key" ON whatsapp."WaWebhookEvent" ("dedupeKey");
CREATE INDEX IF NOT EXISTS "WaWebhookEvent_createdAt_idx" ON whatsapp."WaWebhookEvent" ("createdAt");

-- 4. Envios barrados (fora das 24h, "Assumir", número desconectado, agente
--    cancelado). Nada sai; fica o registro.
CREATE TABLE IF NOT EXISTS whatsapp."WaSendBlock" (
  "id"             TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "ownerUserId"    TEXT NOT NULL,
  "workspaceId"    TEXT NOT NULL,
  "sessionId"      TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "sentBy"         whatsapp."WaSentBy" NOT NULL,
  "reason"         TEXT NOT NULL,
  "agentRunId"     TEXT,
  "preview"        TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaSendBlock_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WaSendBlock_workspaceId_createdAt_idx" ON whatsapp."WaSendBlock" ("workspaceId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "WaSendBlock_conversationId_idx" ON whatsapp."WaSendBlock" ("conversationId");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WaSendBlock_workspaceId_fkey') THEN
    ALTER TABLE whatsapp."WaSendBlock" ADD CONSTRAINT "WaSendBlock_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES public."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- 5. RLS
ALTER TABLE whatsapp."WaWebhookEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp."WaWebhookEvent" FORCE ROW LEVEL SECURITY;
-- (sem policy: le_app não vê nada; le_system tem BYPASSRLS)

ALTER TABLE whatsapp."WaSendBlock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp."WaSendBlock" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_member ON whatsapp."WaSendBlock";
DROP POLICY IF EXISTS admin_audited_read ON whatsapp."WaSendBlock";
CREATE POLICY ws_member ON whatsapp."WaSendBlock" FOR ALL TO PUBLIC
  USING (app.in_current_workspace("workspaceId"))
  WITH CHECK (app.in_current_workspace("workspaceId"));
CREATE POLICY admin_audited_read ON whatsapp."WaSendBlock" FOR SELECT TO PUBLIC
  USING (app.admin_audit_ok("workspaceId"));

-- 6. Permissões (só se os papéis existirem; mesmo padrão da Fase 0).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp."WaSendBlock" TO le_app;
    REVOKE ALL ON whatsapp."WaWebhookEvent" FROM le_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_system') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp."WaSendBlock" TO le_system;
    GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp."WaWebhookEvent" TO le_system;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'não deu pra dar as permissões das tabelas do conector, veja docs/whatsapp-conector.md';
END $$;
