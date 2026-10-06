-- WhatsApp: regras duras do negócio e o agente que aprende com a equipe
-- (pedido do dono, 06/10/2026: "o cara só atende Paulínia e Campinas/SP, não
-- vai atender em outro lugar"; "a IA tem que se auto treinar").
--
-- 1. WaAgentProfile."regrasNegocio": as regras do briefing ESTRUTURADAS
--    (cidades atendidas e não atendidas, regiões com cuidado, exceções,
--    serviços aceitos e recusados, informações mínimas, horário, o que nunca
--    prometer, mensagens aprovadas e casos de teste). O motor confere cada
--    resposta contra elas antes de enviar ou de marcar qualificado. Só muda
--    quando o dono clica em Salvar ou aceita uma sugestão: nunca sozinha.
-- 2. WaAgentExample: exemplos aprendidos (cliente -> resposta da equipe)
--    quando o dono edita um rascunho ou responde depois de assumir. Texto já
--    sem telefone, e-mail, CPF/CNPJ, link e nome do contato. Limite por número
--    no código (os mais antigos saem).
-- 3. WaAgentLearningCase: casos pra o relatório "O que o agente aprendeu"
--    (rascunho descartado, regra que bloqueou ou corrigiu uma resposta, gente
--    de fora da área, serviço recusado). Sem id de conversa: só um hash.
-- 4. WaAgentSuggestion: sugestões de mudança nas regras ou instruções. Só
--    viram regra com o clique do dono (status "aceita").
-- 5. Ficha do lead e estágio no CRM, por conversa (WaConversation): o que o
--    cliente já disse (cada campo com a mensagem de onde veio e se foi
--    confirmado ou inferido) e o estágio (Novo, Em qualificação, Qualificado,
--    Para analisar, Fora do perfil, Cliente, Sem resposta) com o motivo.
--    Mudança manual do dono fica marcada e o agente não sobrescreve sem fato novo.
-- 6. WaLeadStageEvent: histórico de mudança de estágio (quem, quando, motivo).
--    Só INSERT e SELECT: ninguém edita nem apaga o histórico.
-- 7. WaAgentProfile: janela pra juntar mensagens seguidas (3 a 30 s, padrão
--    10), nomes e estágios ocultos por número, e o aviso opcional (desligado)
--    pro WhatsApp do responsável quando o lead fica qualificado.
--
-- SÓ ADITIVA: uma coluna opcional (NULL) e três tabelas novas. Nada é apagado
-- nem muda de tipo. RLS no padrão das tabelas whatsapp.* (membro do workspace
-- ativo; admin só lê com auditoria).

DO $$
BEGIN
  IF to_regprocedure('app.in_current_workspace(text)') IS NULL OR to_regprocedure('app.admin_audit_ok(text)') IS NULL THEN
    RAISE EXCEPTION 'Funções app.in_current_workspace / app.admin_audit_ok não existem: rode a migração da Fase 0 antes';
  END IF;
  IF to_regclass('whatsapp."WaAgentProfile"') IS NULL OR to_regclass('whatsapp."WaSession"') IS NULL THEN
    RAISE EXCEPTION 'Faltam as tabelas dos agentes (20261015140000_wa_agentes)';
  END IF;
END $$;

-- 1. Regras duras (JSON validado no código, lib/whatsapp/regras/esquema.ts).
ALTER TABLE whatsapp."WaAgentProfile" ADD COLUMN IF NOT EXISTS "regrasNegocio" JSONB;
-- Janela pra juntar mensagens seguidas antes de responder (segundos).
ALTER TABLE whatsapp."WaAgentProfile" ADD COLUMN IF NOT EXISTS "debounceSeconds" INTEGER NOT NULL DEFAULT 10;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WaAgentProfile_debounce_check') THEN
    ALTER TABLE whatsapp."WaAgentProfile" ADD CONSTRAINT "WaAgentProfile_debounce_check" CHECK ("debounceSeconds" >= 3 AND "debounceSeconds" <= 30);
  END IF;
END $$;
-- {"qualificado": {"nome": "Pronto pra reunião", "oculto": false}, ...}
ALTER TABLE whatsapp."WaAgentProfile" ADD COLUMN IF NOT EXISTS "estagiosLead" JSONB;
-- {"ligado": false, "telefone": "+5519..."}: mandar o resumo do lead qualificado pro WhatsApp do responsável.
ALTER TABLE whatsapp."WaAgentProfile" ADD COLUMN IF NOT EXISTS "avisarResponsavel" JSONB;

-- 2. Exemplos aprendidos.
CREATE TABLE IF NOT EXISTS whatsapp."WaAgentExample" (
  "id"          TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "workspaceId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "sessionId"   TEXT NOT NULL,
  -- qualificacao | atendimento | suporte (NULL = não se sabe)
  "agente"      TEXT CHECK ("agente" IS NULL OR "agente" IN ('qualificacao', 'atendimento', 'suporte')),
  -- edicao (rascunho editado antes de enviar) | assumir (resposta humana no lugar do agente)
  "origem"      TEXT NOT NULL CHECK ("origem" IN ('edicao', 'assumir')),
  -- id do run ou da mensagem, pra não guardar o mesmo exemplo duas vezes
  "origemId"    TEXT NOT NULL,
  "pergunta"    TEXT NOT NULL CHECK (length("pergunta") <= 600),
  "resposta"    TEXT NOT NULL CHECK (length("resposta") <= 1200),
  -- o que o agente tinha sugerido (só na edição)
  "rascunho"    TEXT CHECK ("rascunho" IS NULL OR length("rascunho") <= 1200),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaAgentExample_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WaAgentExample_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES public."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WaAgentExample_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES whatsapp."WaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "WaAgentExample_sessionId_origemId_key" ON whatsapp."WaAgentExample" ("sessionId", "origemId");
CREATE INDEX IF NOT EXISTS "WaAgentExample_sessionId_createdAt_idx" ON whatsapp."WaAgentExample" ("sessionId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "WaAgentExample_workspaceId_idx" ON whatsapp."WaAgentExample" ("workspaceId");

-- 3. Casos pro relatório.
CREATE TABLE IF NOT EXISTS whatsapp."WaAgentLearningCase" (
  "id"          TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "workspaceId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "sessionId"   TEXT NOT NULL,
  -- descartado | regra_bloqueou | regra_corrigiu | fora_da_area | servico_recusado
  "tipo"        TEXT NOT NULL CHECK ("tipo" IN ('descartado', 'regra_bloqueou', 'regra_corrigiu', 'fora_da_area', 'servico_recusado')),
  -- código da regra (ex.: qualificado_fora_da_area)
  "regra"       TEXT,
  -- cidade ou serviço do caso (ex.: "Hortolândia/SP", "trocar torneira")
  "assunto"     TEXT CHECK ("assunto" IS NULL OR length("assunto") <= 120),
  "pergunta"    TEXT CHECK ("pergunta" IS NULL OR length("pergunta") <= 600),
  "resposta"    TEXT CHECK ("resposta" IS NULL OR length("resposta") <= 1200),
  -- hash da conversa (contar pessoas diferentes sem guardar o id)
  "conversaHash" TEXT,
  "origemId"    TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaAgentLearningCase_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WaAgentLearningCase_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES public."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WaAgentLearningCase_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES whatsapp."WaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "WaAgentLearningCase_sessionId_origemId_key" ON whatsapp."WaAgentLearningCase" ("sessionId", "origemId");
CREATE INDEX IF NOT EXISTS "WaAgentLearningCase_sessionId_createdAt_idx" ON whatsapp."WaAgentLearningCase" ("sessionId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "WaAgentLearningCase_workspaceId_idx" ON whatsapp."WaAgentLearningCase" ("workspaceId");

-- 4. Sugestões (só viram regra com o clique do dono).
CREATE TABLE IF NOT EXISTS whatsapp."WaAgentSuggestion" (
  "id"          TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "workspaceId" TEXT NOT NULL,
  "ownerUserId" TEXT NOT NULL,
  "sessionId"   TEXT NOT NULL,
  -- regra (contagem dos casos, sem IA) | ia (gerada pela IA a partir dos casos)
  "origem"      TEXT NOT NULL CHECK ("origem" IN ('regra', 'ia')),
  -- chave pra não repetir a mesma sugestão (ex.: cidade_analisar:hortolandia/sp)
  "chave"       TEXT NOT NULL,
  "texto"       TEXT NOT NULL CHECK (length("texto") <= 600),
  -- a mudança proposta (validada no código antes de aplicar)
  "mudanca"     JSONB NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'pendente' CHECK ("status" IN ('pendente', 'aceita', 'recusada')),
  "decididoPor" TEXT,
  "decididoEm"  TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaAgentSuggestion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WaAgentSuggestion_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES public."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WaAgentSuggestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES whatsapp."WaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "WaAgentSuggestion_sessionId_chave_key" ON whatsapp."WaAgentSuggestion" ("sessionId", "chave");
CREATE INDEX IF NOT EXISTS "WaAgentSuggestion_sessionId_status_idx" ON whatsapp."WaAgentSuggestion" ("sessionId", "status");
CREATE INDEX IF NOT EXISTS "WaAgentSuggestion_workspaceId_idx" ON whatsapp."WaAgentSuggestion" ("workspaceId");

-- 5. Ficha do lead e estágio no CRM (por conversa).
ALTER TABLE whatsapp."WaConversation" ADD COLUMN IF NOT EXISTS "leadFicha" JSONB;
ALTER TABLE whatsapp."WaConversation" ADD COLUMN IF NOT EXISTS "leadStage" TEXT;
ALTER TABLE whatsapp."WaConversation" ADD COLUMN IF NOT EXISTS "leadStageMotivo" TEXT;
-- regiao | servico | outro (só em fora_do_perfil)
ALTER TABLE whatsapp."WaConversation" ADD COLUMN IF NOT EXISTS "leadStageTipo" TEXT;
ALTER TABLE whatsapp."WaConversation" ADD COLUMN IF NOT EXISTS "leadStageManual" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE whatsapp."WaConversation" ADD COLUMN IF NOT EXISTS "leadStageAt" TIMESTAMP(3);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WaConversation_leadStage_check') THEN
    ALTER TABLE whatsapp."WaConversation" ADD CONSTRAINT "WaConversation_leadStage_check" CHECK (
      "leadStage" IS NULL OR "leadStage" IN ('novo', 'qualificando', 'qualificado', 'analisar', 'fora_do_perfil', 'cliente', 'sem_resposta')
    );
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "WaConversation_workspaceId_leadStage_idx" ON whatsapp."WaConversation" ("workspaceId", "leadStage");

-- 6. Histórico de estágio (só INSERT e SELECT).
CREATE TABLE IF NOT EXISTS whatsapp."WaLeadStageEvent" (
  "id"             TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "workspaceId"    TEXT NOT NULL,
  "sessionId"      TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "de"             TEXT,
  "para"           TEXT NOT NULL,
  "motivo"         TEXT CHECK ("motivo" IS NULL OR length("motivo") <= 500),
  "tipo"           TEXT,
  "manual"         BOOLEAN NOT NULL DEFAULT false,
  -- quem mudou (NULL = o agente)
  "porUserId"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaLeadStageEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WaLeadStageEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES public."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WaLeadStageEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES whatsapp."WaSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WaLeadStageEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES whatsapp."WaConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "WaLeadStageEvent_conversationId_createdAt_idx" ON whatsapp."WaLeadStageEvent" ("conversationId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "WaLeadStageEvent_workspaceId_createdAt_idx" ON whatsapp."WaLeadStageEvent" ("workspaceId", "createdAt" DESC);

ALTER TABLE whatsapp."WaLeadStageEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp."WaLeadStageEvent" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_read ON whatsapp."WaLeadStageEvent";
DROP POLICY IF EXISTS ws_insert ON whatsapp."WaLeadStageEvent";
DROP POLICY IF EXISTS admin_audited_read ON whatsapp."WaLeadStageEvent";
CREATE POLICY ws_read ON whatsapp."WaLeadStageEvent" FOR SELECT TO PUBLIC
  USING (app.in_current_workspace("workspaceId"));
CREATE POLICY ws_insert ON whatsapp."WaLeadStageEvent" FOR INSERT TO PUBLIC
  WITH CHECK (app.in_current_workspace("workspaceId"));
CREATE POLICY admin_audited_read ON whatsapp."WaLeadStageEvent" FOR SELECT TO PUBLIC
  USING (app.admin_audit_ok("workspaceId"));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_app') THEN
    GRANT SELECT, INSERT ON whatsapp."WaLeadStageEvent" TO le_app;
    REVOKE UPDATE, DELETE ON whatsapp."WaLeadStageEvent" FROM le_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_system') THEN
    GRANT SELECT, INSERT ON whatsapp."WaLeadStageEvent" TO le_system;
    REVOKE UPDATE, DELETE ON whatsapp."WaLeadStageEvent" FROM le_system;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'não deu pra dar as permissões do histórico de estágio, veja docs/whatsapp-agentes.md';
END $$;

-- 7. RLS (igual às tabelas dos agentes).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['WaAgentExample', 'WaAgentLearningCase', 'WaAgentSuggestion']
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp."WaAgentExample", whatsapp."WaAgentLearningCase", whatsapp."WaAgentSuggestion" TO le_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_system') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp."WaAgentExample", whatsapp."WaAgentLearningCase", whatsapp."WaAgentSuggestion" TO le_system;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'não deu pra dar as permissões das regras e do aprendizado, veja docs/whatsapp-agentes.md';
END $$;
