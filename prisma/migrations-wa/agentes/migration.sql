-- Motor dos agentes do WhatsApp (branch feat/wa-agentes).
--
-- NÃO roda sozinho: prisma/migrations-wa/ fica fora do "prisma migrate deploy".
-- Aplicar DEPOIS da migração da Fase 0 que cria o schema "whatsapp", as tabelas
-- do plano (WaSession, WaConversation, WaAgentProfile, WaAgentRun...) e as
-- funções app.current_user_id() / app.is_admin(). Na junção, o conteúdo daqui
-- vira uma migração Prisma normal (ver docs/whatsapp-agentes.md).
-- Só adiciona coisa. Nada é apagado.

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

-- 4. Memória curta por contato
CREATE TABLE IF NOT EXISTS whatsapp."WaContactMemory" (
  "contactId"    TEXT PRIMARY KEY REFERENCES whatsapp."WaContact"("id") ON DELETE CASCADE,
  "ownerUserId"  TEXT NOT NULL,
  "resumo"       TEXT,
  "fatos"        JSONB NOT NULL DEFAULT '[]'::jsonb,
  "ultimoAgente" TEXT,
  "atualizadoEm" TIMESTAMP(3)
);
CREATE INDEX IF NOT EXISTS "WaContactMemory_ownerUserId_idx" ON whatsapp."WaContactMemory" ("ownerUserId");

-- 5. RLS nas tabelas novas: dono ou admin (mesma regra das outras whatsapp.*)
DO $$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_app') THEN
    RAISE NOTICE 'papel le_app não existe ainda: rode a Fase 0 antes';
    RETURN;
  END IF;
  FOREACH t IN ARRAY ARRAY['WaAgentConfig', 'WaContactMemory']
  LOOP
    EXECUTE format('ALTER TABLE whatsapp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE whatsapp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS owner_or_admin ON whatsapp.%I', t);
    EXECUTE format($p$
      CREATE POLICY owner_or_admin ON whatsapp.%I FOR ALL TO le_app
      USING ("ownerUserId" = app.current_user_id() OR app.is_admin())
      WITH CHECK ("ownerUserId" = app.current_user_id() OR app.is_admin())
    $p$, t);
  END LOOP;
END $$;
