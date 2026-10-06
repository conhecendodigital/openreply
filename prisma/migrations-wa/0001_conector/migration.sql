-- Conector de WhatsApp (feat/wa-conector).
-- Roda DEPOIS da migração da Fase 0 que cria o schema "whatsapp" (WaSession,
-- WaMessage...) e os papéis le_app / le_system. Não é uma migração do Prisma:
-- quando a Fase 0 juntar, estes campos entram no schema.prisma e este SQL vira
-- parte da migração gerada (ver docs/whatsapp-conector.md).

-- 1. Cloud API (coexistência): o WABA do número e o token de negócio cifrado
--    (AES-256-GCM, mesmo encryptToken de lib/meta/oauth.ts). OpenWA não usa.
ALTER TABLE whatsapp."WaSession" ADD COLUMN IF NOT EXISTS "wabaId" TEXT;
ALTER TABLE whatsapp."WaSession" ADD COLUMN IF NOT EXISTS "accessTokenEnc" TEXT;

-- 2. Regra das 24h: achar rápido a última mensagem do contato numa conversa.
CREATE INDEX IF NOT EXISTS "WaMessage_conversationId_sentBy_sentAt_idx"
  ON whatsapp."WaMessage" ("conversationId", "sentBy", "sentAt" DESC);

-- 3. Envios barrados (fora das 24h, "Assumir", número desconectado).
--    Envio do agente também marca WaAgentRun.status = 'blocked' + blockedReason.
CREATE TABLE IF NOT EXISTS whatsapp."WaSendBlock" (
  "id"             TEXT PRIMARY KEY,
  "ownerUserId"    TEXT NOT NULL,
  "workspaceId"    TEXT NOT NULL,
  "sessionId"      TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "sentBy"         whatsapp."WaSentBy" NOT NULL, -- nome do enum na Fase 0 (não "SentBy")
  "reason"         TEXT NOT NULL,
  "agentRunId"     TEXT,
  "preview"        TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "WaSendBlock_ownerUserId_createdAt_idx"
  ON whatsapp."WaSendBlock" ("ownerUserId", "createdAt" DESC);

ALTER TABLE whatsapp."WaSendBlock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp."WaSendBlock" FORCE ROW LEVEL SECURITY;
-- Mesma regra das tabelas whatsapp.* da Fase 0: membro do workspace ATIVO faz
-- tudo; admin só lê, e só com registro de auditoria (app.admin_audit_ok).
-- (Antes: dono OU admin com acesso total, sem auditoria.)
DROP POLICY IF EXISTS owner_or_admin ON whatsapp."WaSendBlock";
DROP POLICY IF EXISTS ws_member ON whatsapp."WaSendBlock";
DROP POLICY IF EXISTS admin_audited_read ON whatsapp."WaSendBlock";
CREATE POLICY ws_member ON whatsapp."WaSendBlock" FOR ALL TO PUBLIC
  USING (app.in_current_workspace("workspaceId"))
  WITH CHECK (app.in_current_workspace("workspaceId"));
CREATE POLICY admin_audited_read ON whatsapp."WaSendBlock" FOR SELECT TO PUBLIC
  USING (app.admin_audit_ok("workspaceId"));
