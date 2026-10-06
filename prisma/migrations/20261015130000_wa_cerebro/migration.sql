-- WhatsApp, fase 1: cérebro dos agentes (PDFs -> pedaços com embedding) e
-- memória curta por contato. Era prisma/migrations-wa/cerebro.
--
-- SÓ ADITIVA. A tabela de gasto (whatsapp."WaAiUsage") NÃO é criada aqui: ela
-- veio na 20261014120000_ia_chaves_e_gastos, com a RLS por usuário que o dono
-- pediu.
--
-- pgvector: se o Postgres tiver a extensão "vector" (imagem pgvector/pgvector),
-- os pedaços ganham coluna vector(1536) com índice HNSW. Se NÃO tiver (imagem
-- postgres:16 comum), a migração NÃO falha: a coluna vira real[] e a busca usa a
-- função whatsapp.wa_cosine_distance (mais lenta, boa pro beta). Dá pra trocar
-- pra pgvector depois sem perder os PDFs (os bytes ficam guardados).

DO $$
BEGIN
  IF to_regprocedure('app.in_current_workspace(text)') IS NULL OR to_regprocedure('app.admin_audit_ok(text)') IS NULL THEN
    RAISE EXCEPTION 'Funções app.in_current_workspace / app.admin_audit_ok não existem: rode a migração da Fase 0 antes';
  END IF;
  IF to_regclass('whatsapp."WaContact"') IS NULL THEN
    RAISE EXCEPTION 'Falta whatsapp.WaContact (Fase 0)';
  END IF;
END $$;

-- Tenta ligar o pgvector sem derrubar a migração.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector indisponível neste Postgres (%): o cérebro usa a busca sem pgvector', SQLERRM;
END $$;

-- ─── Documentos (1 PDF enviado) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp."WaKnowledgeDocument" (
  "id"              TEXT NOT NULL,
  "ownerUserId"     TEXT NOT NULL,
  "workspaceId"     TEXT NOT NULL,
  "agentKind"       TEXT NOT NULL CHECK ("agentKind" IN ('qualificacao', 'atendimento', 'suporte')),
  -- número específico (WaSession.id) ou NULL = todos os números do workspace
  "sessionId"       TEXT,
  "fileName"        TEXT NOT NULL CHECK (length("fileName") <= 120),
  "sizeBytes"       INTEGER NOT NULL CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 8388608),
  "sha256"          TEXT NOT NULL,
  -- bytes do PDF, guardados pra reprocessar (ex.: trocar o modelo de embedding)
  "data"            BYTEA,
  "pageCount"       INTEGER,
  "status"          TEXT NOT NULL DEFAULT 'queued' CHECK ("status" IN ('queued', 'processing', 'ready', 'error')),
  "errorCode"       TEXT,
  "chunkCount"      INTEGER NOT NULL DEFAULT 0,
  "embeddingModel"  TEXT,
  "embeddingTokens" INTEGER NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "processedAt"     TIMESTAMPTZ(6),
  CONSTRAINT "WaKnowledgeDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WaKnowledgeDocument_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES public."User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WaKnowledgeDocument_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES public."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- o mesmo PDF duas vezes no mesmo agente não duplica
CREATE UNIQUE INDEX IF NOT EXISTS "WaKnowledgeDocument_ws_agent_sha_key"
  ON whatsapp."WaKnowledgeDocument" ("workspaceId", "agentKind", "sha256");
CREATE INDEX IF NOT EXISTS "WaKnowledgeDocument_ws_agent_idx"
  ON whatsapp."WaKnowledgeDocument" ("workspaceId", "agentKind", "createdAt" DESC);

-- ─── Pedaços com embedding ───────────────────────────────────────────────────
DO $$
DECLARE
  tem_vector boolean := EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector');
  tipo text;
BEGIN
  IF to_regclass('whatsapp."WaKnowledgeChunk"') IS NOT NULL THEN
    RETURN;
  END IF;
  tipo := CASE WHEN tem_vector THEN 'vector(1536)' ELSE 'real[]' END;
  EXECUTE format($t$
    CREATE TABLE whatsapp."WaKnowledgeChunk" (
      "id"             TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
      "documentId"     TEXT NOT NULL,
      "ownerUserId"    TEXT NOT NULL,
      "workspaceId"    TEXT NOT NULL,
      "agentKind"      TEXT NOT NULL CHECK ("agentKind" IN ('qualificacao', 'atendimento', 'suporte')),
      "sessionId"      TEXT,
      "position"       INTEGER NOT NULL,
      "page"           INTEGER NOT NULL,
      "content"        TEXT NOT NULL CHECK (length("content") <= 4000),
      "tokenEstimate"  INTEGER NOT NULL,
      "embeddingModel" TEXT NOT NULL,
      "embedding"      %s NOT NULL,
      "createdAt"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
      CONSTRAINT "WaKnowledgeChunk_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "WaKnowledgeChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES whatsapp."WaKnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "WaKnowledgeChunk_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES public."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
    )$t$, tipo);
  IF tem_vector THEN
    -- busca por cosseno (operador <=>); HNSW exige pgvector >= 0.5
    BEGIN
      EXECUTE 'CREATE INDEX "WaKnowledgeChunk_embedding_hnsw" ON whatsapp."WaKnowledgeChunk"
               USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64)';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'índice HNSW não criado (%): a busca funciona, só mais devagar', SQLERRM;
    END;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "WaKnowledgeChunk_documentId_position_key"
  ON whatsapp."WaKnowledgeChunk" ("documentId", "position");
CREATE INDEX IF NOT EXISTS "WaKnowledgeChunk_ws_agent_idx"
  ON whatsapp."WaKnowledgeChunk" ("workspaceId", "agentKind", "embeddingModel");

-- Distância de cosseno pra coluna real[] (só usada quando não há pgvector).
CREATE OR REPLACE FUNCTION whatsapp.wa_cosine_distance(a real[], b real[]) RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN sqrt(sum(x * x)) = 0 OR sqrt(sum(y * y)) = 0 THEN 1
              ELSE 1 - sum(x * y) / (sqrt(sum(x * x)) * sqrt(sum(y * y))) END
  FROM unnest(a, b) AS t(x, y)
$$;

-- ─── Memória do contato (resumo curto) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS whatsapp."WaContactMemory" (
  "contactId"   TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "nome"        TEXT CHECK (length("nome") <= 60),
  "interesse"   TEXT CHECK (length("interesse") <= 200),
  "objecao"     TEXT CHECK (length("objecao") <= 200),
  "etapa"       TEXT NOT NULL DEFAULT 'novo'
                CHECK ("etapa" IN ('novo', 'qualificando', 'interessado', 'negociando', 'cliente', 'suporte', 'perdido')),
  "observacao"  TEXT CHECK (length("observacao") <= 240),
  "version"     INTEGER NOT NULL DEFAULT 1,
  "updatedAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "WaContactMemory_pkey" PRIMARY KEY ("workspaceId", "contactId"),
  CONSTRAINT "WaContactMemory_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES public."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WaContactMemory_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES whatsapp."WaContact"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- ─── RLS (igual às tabelas whatsapp.* da Fase 0) ─────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['WaKnowledgeDocument', 'WaKnowledgeChunk', 'WaContactMemory']
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp."WaKnowledgeDocument", whatsapp."WaKnowledgeChunk", whatsapp."WaContactMemory" TO le_app;
    GRANT EXECUTE ON FUNCTION whatsapp.wa_cosine_distance(real[], real[]) TO le_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_system') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp."WaKnowledgeDocument", whatsapp."WaKnowledgeChunk", whatsapp."WaContactMemory" TO le_system;
    GRANT EXECUTE ON FUNCTION whatsapp.wa_cosine_distance(real[], real[]) TO le_system;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'não deu pra dar as permissões do cérebro, veja lib/whatsapp/cerebro/README.md';
END $$;
