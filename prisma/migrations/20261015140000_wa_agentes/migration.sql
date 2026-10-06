-- WhatsApp, fase 1: os 3 agentes (qualificação, atendimento, suporte).
-- Era prisma/migrations-wa/agentes, que dependia de WaAgentRun e
-- WaAgentProfile que a Fase 0 não criou: aqui elas nascem completas.
--
-- SÓ ADITIVA. Tudo nasce DESLIGADO: WaAgentConfig.ativo = false e
-- WaSession.agentMode continua OFF (padrão da Fase 0). A chave de IA é a do
-- /admin (PlatformAiCredential); por isso não há tabela AiCredential por dono.

DO $$
BEGIN
  IF to_regprocedure('app.in_current_workspace(text)') IS NULL OR to_regprocedure('app.admin_audit_ok(text)') IS NULL THEN
    RAISE EXCEPTION 'Funções app.in_current_workspace / app.admin_audit_ok não existem: rode a migração da Fase 0 antes';
  END IF;
  IF to_regclass('whatsapp."WaSession"') IS NULL OR to_regclass('whatsapp."WaConversation"') IS NULL THEN
    RAISE EXCEPTION 'Faltam as tabelas whatsapp da Fase 0';
  END IF;
END $$;

-- 1. Perfil do agente por número: Comando base, tom aprendido, silêncio, teto
--    de envios automáticos e atraso humano antes da 1ª bolha.
CREATE TABLE IF NOT EXISTS whatsapp."WaAgentProfile" (
  "id"              TEXT NOT NULL,
  "workspaceId"     TEXT NOT NULL,
  "ownerUserId"     TEXT NOT NULL,
  "sessionId"       TEXT NOT NULL,
  "baseCommand"     TEXT NOT NULL DEFAULT '' CHECK (length("baseCommand") <= 8000),
  "styleSummary"    TEXT,
  "styleExamples"   JSONB,
  -- {"start":"21:00","end":"08:00"}
  "quietHours"      JSONB,
  "maxAutoPerDay"   INTEGER NOT NULL DEFAULT 50 CHECK ("maxAutoPerDay" >= 0 AND "maxAutoPerDay" <= 1000),
  "fatosPermitidos" JSONB,
  "timeZone"        TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  "delayMinSeconds" INTEGER NOT NULL DEFAULT 20 CHECK ("delayMinSeconds" >= 0 AND "delayMinSeconds" <= 600),
  "delayMaxSeconds" INTEGER NOT NULL DEFAULT 90 CHECK ("delayMaxSeconds" >= 0 AND "delayMaxSeconds" <= 600),
  "learnedAt"       TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaAgentProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WaAgentProfile_delay_check" CHECK ("delayMinSeconds" <= "delayMaxSeconds"),
  CONSTRAINT "WaAgentProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES public."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WaAgentProfile_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES whatsapp."WaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "WaAgentProfile_sessionId_key" ON whatsapp."WaAgentProfile" ("sessionId");

-- 2. Cada resposta do agente (rascunho, envio, bloqueio, erro), com custo.
CREATE TABLE IF NOT EXISTS whatsapp."WaAgentRun" (
  "id"             TEXT NOT NULL,
  "workspaceId"    TEXT NOT NULL,
  "ownerUserId"    TEXT NOT NULL,
  "sessionId"      TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "triggerMsgId"   TEXT NOT NULL,
  -- qualificacao | atendimento | suporte
  "agente"         TEXT,
  "mode"           whatsapp."WaAgentMode" NOT NULL,
  -- pending | draft | approved | scheduled | sent | rejected | blocked | error | skipped | handoff
  "status"         TEXT NOT NULL,
  -- {"bolhas": [...], "motivo": "..."}
  "output"         JSONB,
  "blockedReason"  TEXT,
  -- anthropic | openai
  "provider"       TEXT,
  "model"          TEXT,
  "tokensIn"       INTEGER NOT NULL DEFAULT 0,
  "tokensOut"      INTEGER NOT NULL DEFAULT 0,
  "cacheRead"      INTEGER NOT NULL DEFAULT 0,
  "cacheWrite"     INTEGER NOT NULL DEFAULT 0,
  -- 1 dólar = 1.000.000. Run "pending" guarda a reserva do pior caso (teto).
  "custoUsdMicro"  INTEGER NOT NULL DEFAULT 0,
  "triagem"        JSONB,
  "approvedBy"     TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaAgentRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WaAgentRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES public."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WaAgentRun_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES whatsapp."WaConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "WaAgentRun_ownerUserId_createdAt_idx" ON whatsapp."WaAgentRun" ("ownerUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "WaAgentRun_workspaceId_createdAt_idx" ON whatsapp."WaAgentRun" ("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "WaAgentRun_sessionId_createdAt_idx" ON whatsapp."WaAgentRun" ("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "WaAgentRun_conversationId_status_idx" ON whatsapp."WaAgentRun" ("conversationId", "status");

-- 3. Os 3 agentes de cada número: liga/desliga e instrução extra. Provedor e
--    modelo vêm do /admin (PlatformAiSettings); as colunas ficam pra quando
--    cada número puder escolher.
CREATE TABLE IF NOT EXISTS whatsapp."WaAgentConfig" (
  "id"            TEXT NOT NULL,
  "workspaceId"   TEXT NOT NULL,
  "ownerUserId"   TEXT NOT NULL,
  "sessionId"     TEXT NOT NULL,
  "agente"        TEXT NOT NULL CHECK ("agente" IN ('qualificacao', 'atendimento', 'suporte')),
  "ativo"         BOOLEAN NOT NULL DEFAULT false,
  "provider"      TEXT CHECK ("provider" IS NULL OR "provider" IN ('anthropic', 'openai')),
  "modelo"        TEXT,
  "modeloDificil" TEXT,
  "instrucoes"    TEXT CHECK ("instrucoes" IS NULL OR length("instrucoes") <= 4000),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaAgentConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WaAgentConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES public."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WaAgentConfig_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES whatsapp."WaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "WaAgentConfig_sessionId_agente_key" ON whatsapp."WaAgentConfig" ("sessionId", "agente");
CREATE INDEX IF NOT EXISTS "WaAgentConfig_workspaceId_idx" ON whatsapp."WaAgentConfig" ("workspaceId");

-- 4. RLS (igual às tabelas whatsapp.* da Fase 0)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['WaAgentProfile', 'WaAgentRun', 'WaAgentConfig']
  LOOP
    EXECUTE format('ALTER TABLE whatsapp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE whatsapp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS ws_member ON whatsapp.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS admin_audited_read ON whatsapp.%I', t);
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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp."WaAgentProfile", whatsapp."WaAgentRun", whatsapp."WaAgentConfig" TO le_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_system') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp."WaAgentProfile", whatsapp."WaAgentRun", whatsapp."WaAgentConfig" TO le_system;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'não deu pra dar as permissões dos agentes, veja docs/whatsapp-agentes.md';
END $$;
