-- Cérebro dos agentes de WhatsApp: base de conhecimento (PDF -> pedaços com
-- embedding), memória por contato e registro de gasto de IA.
--
-- Fica FORA de prisma/migrations de propósito (não briga com a Fase 0).
-- Rodar DEPOIS da migração da Fase 0, que cria o schema "whatsapp", os papéis
-- le_app / le_system e as funções app.my_workspace_ids() e app.is_admin().
-- Roda como le_owner (dono das tabelas). Ver lib/whatsapp/cerebro/README.md.

-- pgvector: no Postgres do Dokploy a imagem precisa ter a extensão
-- (pgvector/pgvector:pg16 ou superior). HNSW exige pgvector >= 0.5.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS whatsapp;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_app') THEN
    RAISE EXCEPTION 'Papel le_app não existe: rode a migração da Fase 0 antes do cérebro';
  END IF;
  IF to_regprocedure('app.my_workspace_ids()') IS NULL OR to_regprocedure('app.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'Funções app.my_workspace_ids() / app.is_admin() não existem: rode a Fase 0 antes';
  END IF;
END $$;

-- ─── Documentos (1 PDF enviado) ──────────────────────────────────────────────
CREATE TABLE whatsapp."WaKnowledgeDocument" (
  "id"              text PRIMARY KEY,
  "ownerUserId"     text NOT NULL REFERENCES public."User"("id") ON DELETE CASCADE,
  "workspaceId"     text NOT NULL REFERENCES public."Workspace"("id") ON DELETE CASCADE,
  "agentKind"       text NOT NULL CHECK ("agentKind" IN ('qualificacao', 'atendimento', 'suporte')),
  -- número específico (WaSession.id) ou NULL = todos os números do workspace
  "sessionId"       text,
  "fileName"        text NOT NULL CHECK (length("fileName") <= 120),
  "sizeBytes"       integer NOT NULL CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 8388608),
  "sha256"          text NOT NULL,
  -- bytes do PDF, guardados pra reprocessar (ex.: trocar o modelo de embedding)
  "data"            bytea,
  "pageCount"       integer,
  "status"          text NOT NULL DEFAULT 'queued' CHECK ("status" IN ('queued', 'processing', 'ready', 'error')),
  "errorCode"       text,
  "chunkCount"      integer NOT NULL DEFAULT 0,
  "embeddingModel"  text,
  "embeddingTokens" integer NOT NULL DEFAULT 0,
  "createdAt"       timestamptz NOT NULL DEFAULT now(),
  "processedAt"     timestamptz
);
-- o mesmo PDF duas vezes no mesmo agente não duplica
CREATE UNIQUE INDEX "WaKnowledgeDocument_ws_agent_sha_key"
  ON whatsapp."WaKnowledgeDocument" ("workspaceId", "agentKind", "sha256");
CREATE INDEX "WaKnowledgeDocument_ws_agent_idx"
  ON whatsapp."WaKnowledgeDocument" ("workspaceId", "agentKind", "createdAt" DESC);

-- ─── Pedaços com embedding ───────────────────────────────────────────────────
CREATE TABLE whatsapp."WaKnowledgeChunk" (
  "id"             text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "documentId"     text NOT NULL REFERENCES whatsapp."WaKnowledgeDocument"("id") ON DELETE CASCADE,
  "ownerUserId"    text NOT NULL,
  "workspaceId"    text NOT NULL REFERENCES public."Workspace"("id") ON DELETE CASCADE,
  "agentKind"      text NOT NULL CHECK ("agentKind" IN ('qualificacao', 'atendimento', 'suporte')),
  "sessionId"      text,
  "position"       integer NOT NULL,
  "page"           integer NOT NULL,
  "content"        text NOT NULL CHECK (length("content") <= 4000),
  "tokenEstimate"  integer NOT NULL,
  "embeddingModel" text NOT NULL,
  "embedding"      vector(1536) NOT NULL,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("documentId", "position")
);
-- busca por cosseno (operador <=>)
CREATE INDEX "WaKnowledgeChunk_embedding_hnsw"
  ON whatsapp."WaKnowledgeChunk" USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
CREATE INDEX "WaKnowledgeChunk_ws_agent_idx"
  ON whatsapp."WaKnowledgeChunk" ("workspaceId", "agentKind", "embeddingModel");

-- ─── Memória do contato (resumo curto) ───────────────────────────────────────
CREATE TABLE whatsapp."WaContactMemory" (
  -- WaContact.id. A FK entra quando a tabela WaContact (Fase 1) existir:
  -- ALTER TABLE whatsapp."WaContactMemory" ADD FOREIGN KEY ("contactId")
  --   REFERENCES whatsapp."WaContact"("id") ON DELETE CASCADE;
  "contactId"   text NOT NULL,
  "workspaceId" text NOT NULL REFERENCES public."Workspace"("id") ON DELETE CASCADE,
  "ownerUserId" text NOT NULL,
  "nome"        text CHECK (length("nome") <= 60),
  "interesse"   text CHECK (length("interesse") <= 200),
  "objecao"     text CHECK (length("objecao") <= 200),
  "etapa"       text NOT NULL DEFAULT 'novo'
                CHECK ("etapa" IN ('novo', 'qualificando', 'interessado', 'negociando', 'cliente', 'suporte', 'perdido')),
  "observacao"  text CHECK (length("observacao") <= 240),
  "version"     integer NOT NULL DEFAULT 1,
  "updatedAt"   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("workspaceId", "contactId")
);

-- ─── Gasto de IA (tokens e custo estimado) ───────────────────────────────────
CREATE TABLE whatsapp."WaAiUsage" (
  "id"           text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "ownerUserId"  text NOT NULL,
  "workspaceId"  text NOT NULL REFERENCES public."Workspace"("id") ON DELETE CASCADE,
  "kind"         text NOT NULL,            -- embedding | memory | agent | triage
  "provider"     text NOT NULL,
  "model"        text NOT NULL,
  "tokensIn"     integer NOT NULL DEFAULT 0,
  "tokensOut"    integer NOT NULL DEFAULT 0,
  "costMicroUsd" bigint NOT NULL DEFAULT 0, -- 1 = US$ 0,000001
  "refId"        text,
  "createdAt"    timestamptz NOT NULL DEFAULT now()
);
-- teto diário: soma do dia por dono
CREATE INDEX "WaAiUsage_owner_created_idx" ON whatsapp."WaAiUsage" ("ownerUserId", "createdAt" DESC);

-- ─── RLS por workspace (segunda tranca, além do filtro no código) ────────────
-- Mesma regra das tabelas whatsapp.* da Fase 0: só o workspace ATIVO
-- (app.workspace_id) e só se a pessoa for membro dele; admin só LÊ, e só com
-- registro de auditoria (app.admin_audit_ok). Antes era "qualquer workspace
-- da pessoa OU admin com escrita total": uma chave de API do workspace A
-- alcançava o cérebro do workspace B do mesmo dono, e o admin lia memória de
-- contato de terceiros sem deixar rastro.
DO $$
BEGIN
  IF to_regprocedure('app.in_current_workspace(text)') IS NULL OR to_regprocedure('app.admin_audit_ok(text)') IS NULL THEN
    RAISE EXCEPTION 'Funções app.in_current_workspace / app.admin_audit_ok não existem: rode a Fase 0 antes';
  END IF;
END $$;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['WaKnowledgeDocument', 'WaKnowledgeChunk', 'WaContactMemory', 'WaAiUsage']
  LOOP
    EXECUTE format('ALTER TABLE whatsapp.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE whatsapp.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($p$
      CREATE POLICY ws_member ON whatsapp.%I FOR ALL TO PUBLIC
      USING (app.in_current_workspace("workspaceId"))
      WITH CHECK (app.in_current_workspace("workspaceId"))
    $p$, t);
    EXECUTE format($p$
      CREATE POLICY admin_audited_read ON whatsapp.%I FOR SELECT TO PUBLIC
      USING (app.admin_audit_ok("workspaceId"))
    $p$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp.%I TO le_app', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_system') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp.%I TO le_system', t);
    END IF;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA whatsapp TO le_app;
