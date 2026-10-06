-- Motor dos agentes do WhatsApp (branch feat/wa-agentes).
--
-- NÃO roda sozinho: prisma/migrations-wa/ fica fora do "prisma migrate deploy".
-- Aplicar DEPOIS da migração da Fase 0 que cria o schema "whatsapp", as tabelas
-- do plano (WaSession, WaConversation, WaAgentProfile, WaAgentRun...) e as
-- funções app.current_user_id() / app.is_admin(). Na junção, o conteúdo daqui
-- vira uma migração Prisma normal (ver docs/whatsapp-agentes.md).
-- Só adiciona coisa. Nada é apagado.

-- 0. Para ANTES de criar qualquer tabela se a Fase 0 não rodou (sem le_app não há RLS).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_app') THEN
    RAISE EXCEPTION 'papel le_app não existe: rode a migração da Fase 0 antes desta';
  END IF;
  -- A Fase 0 real (feat/multiusuario) NÃO criou WaAgentRun, WaAgentProfile nem
  -- AiCredential: precisam de uma migração antes desta (revisão 06/10).
  IF to_regclass('whatsapp."WaAgentRun"') IS NULL OR to_regclass('whatsapp."WaAgentProfile"') IS NULL THEN
    RAISE EXCEPTION 'Faltam whatsapp.WaAgentRun / WaAgentProfile: crie antes (não estão na migração da Fase 0)';
  END IF;
  IF to_regprocedure('app.in_current_workspace(text)') IS NULL OR to_regprocedure('app.admin_audit_ok(text)') IS NULL THEN
    RAISE EXCEPTION 'Funções app.in_current_workspace / app.admin_audit_ok não existem: rode a Fase 0 antes';
  END IF;
END $$;

-- 1. WaAgentRun: colunas que o motor grava além do plano
ALTER TABLE whatsapp."WaAgentRun"
  ADD COLUMN IF NOT EXISTS "workspaceId"   TEXT,
  ADD COLUMN IF NOT EXISTS "sessionId"     TEXT,
  ADD COLUMN IF NOT EXISTS "agente"        TEXT,             -- qualificacao | atendimento | suporte
  ADD COLUMN IF NOT EXISTS "provider"      TEXT,             -- anthropic | openai
  ADD COLUMN IF NOT EXISTS "cacheRead"     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cacheWrite"    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "custoUsdMicro" INTEGER NOT NULL DEFAULT 0, -- 1 dólar = 1.000.000
  ADD COLUMN IF NOT EXISTS "triagem"       JSONB,
  ADD COLUMN IF NOT EXISTS "approvedBy"    TEXT;

-- Soma do dia pro teto (por dono já existe: ownerUserId, createdAt)
CREATE INDEX IF NOT EXISTS "WaAgentRun_workspaceId_createdAt_idx" ON whatsapp."WaAgentRun" ("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "WaAgentRun_sessionId_createdAt_idx" ON whatsapp."WaAgentRun" ("sessionId", "createdAt");
CREATE INDEX IF NOT EXISTS "WaAgentRun_conversationId_status_idx" ON whatsapp."WaAgentRun" ("conversationId", "status");

-- 2. WaAgentProfile: fatos que o agente pode citar e fuso do número
ALTER TABLE whatsapp."WaAgentProfile"
  ADD COLUMN IF NOT EXISTS "fatosPermitidos" JSONB,
  ADD COLUMN IF NOT EXISTS "timeZone"        TEXT NOT NULL DEFAULT 'America/Sao_Paulo';

-- 3. Configuração de cada um dos 3 agentes por número
CREATE TABLE IF NOT EXISTS whatsapp."WaAgentConfig" (
  "id"            TEXT PRIMARY KEY,
  "ownerUserId"   TEXT NOT NULL,
  "workspaceId"   TEXT NOT NULL,
  "sessionId"     TEXT NOT NULL REFERENCES whatsapp."WaSession"("id") ON DELETE CASCADE,
  "agente"        TEXT NOT NULL CHECK ("agente" IN ('qualificacao', 'atendimento', 'suporte')),
  "ativo"         BOOLEAN NOT NULL DEFAULT false,
  "provider"      TEXT NOT NULL DEFAULT 'anthropic' CHECK ("provider" IN ('anthropic', 'openai')),
  "modelo"        TEXT,
  "modeloDificil" TEXT,
  "instrucoes"    TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "WaAgentConfig_sessionId_agente_key" ON whatsapp."WaAgentConfig" ("sessionId", "agente");
CREATE INDEX IF NOT EXISTS "WaAgentConfig_ownerUserId_idx" ON whatsapp."WaAgentConfig" ("ownerUserId");

-- 4. Memória curta por contato: NÃO é criada aqui. A tabela WaContactMemory é a
--    do feat/wa-cerebro (por workspace, nome/interesse/objeção/etapa/observação,
--    com limite de tamanho). Criar outra com o mesmo nome e formato diferente
--    fazia o "IF NOT EXISTS" ficar com a primeira e o store quebrar em produção.
--    O AgentStore lê e grava a do cérebro (resumo = renderMemory dela).

-- 5. RLS: a mesma das tabelas whatsapp.* da Fase 0 (workspace ATIVO + membro;
--    admin só lê com auditoria). Antes: dono OU admin com escrita total.
ALTER TABLE whatsapp."WaAgentConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp."WaAgentConfig" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_or_admin ON whatsapp."WaAgentConfig";
DROP POLICY IF EXISTS ws_member ON whatsapp."WaAgentConfig";
DROP POLICY IF EXISTS admin_audited_read ON whatsapp."WaAgentConfig";
CREATE POLICY ws_member ON whatsapp."WaAgentConfig" FOR ALL TO PUBLIC
  USING (app.in_current_workspace("workspaceId"))
  WITH CHECK (app.in_current_workspace("workspaceId"));
CREATE POLICY admin_audited_read ON whatsapp."WaAgentConfig" FOR SELECT TO PUBLIC
  USING (app.admin_audit_ok("workspaceId"));
-- AiCredential (quando for criada) fica com policy SÓ do dono, sem admin:
--   USING ("ownerUserId" = app.current_user_id()) WITH CHECK (mesma coisa).
