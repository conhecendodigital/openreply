-- Links rastreados: prévia bonita e link curto (07/10/2026).
--
-- Pedido do dono: a DM em texto mostrava a prévia do link com a marca do Lead
-- Engine e um link enorme (many.leadenginer.com/r/<slug>?c=<igsid>.<assinatura>).
-- "a prévia desse link não teria como ser uma capa do quiz [...] porque isso
-- aí também tá feio".
--
-- 1. Workspace."linkDomain": domínio próprio dos links (ex.:
--    comando.cloudmatheus.com.br). Só o host. Nesse host o app só responde
--    /r/* (proxy.ts). NULL = os links continuam em NEXTAUTH_URL.
-- 2. TrackedLink: título, descrição e imagem da prévia (opcionais). Sem eles a
--    prévia vem da capa do quiz, da página de destino ou só do nome do link.
-- 3. TrackedLinkRecipient: o código curto por pessoa (/r/<slug>/<codigo>) no
--    lugar de ?c=<igsid>.<assinatura>. O formato antigo continua valendo.
--
-- SÓ ADITIVA: três colunas opcionais (NULL) em TrackedLink, uma em Workspace,
-- uma tabela nova e índices. Nada é apagado nem muda de tipo. Workspace e
-- TrackedLink seguem sem RLS (filtro por workspaceId no código, igual à
-- 20261017120000_dm_formato_texto). A tabela nova nasce com RLS forçada no
-- padrão da Fase 0.

DO $$
BEGIN
  IF to_regprocedure('app.in_current_workspace(text)') IS NULL OR to_regprocedure('app.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'Funções app.in_current_workspace / app.is_admin não existem: rode a migração da Fase 0 antes';
  END IF;
END $$;

-- 1. Domínio dos links (um workspace por domínio).
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "linkDomain" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Workspace_linkDomain_key" ON "Workspace"("linkDomain");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Workspace_linkDomain_check') THEN
    ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_linkDomain_check"
      CHECK ("linkDomain" IS NULL OR ("linkDomain" ~ '^[a-z0-9.-]+$' AND length("linkDomain") <= 253));
  END IF;
END $$;

-- 2. Prévia do link.
ALTER TABLE "TrackedLink" ADD COLUMN IF NOT EXISTS "previewTitle" TEXT;
ALTER TABLE "TrackedLink" ADD COLUMN IF NOT EXISTS "previewDescription" TEXT;
ALTER TABLE "TrackedLink" ADD COLUMN IF NOT EXISTS "previewImageUrl" TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TrackedLink_preview_check') THEN
    ALTER TABLE "TrackedLink" ADD CONSTRAINT "TrackedLink_preview_check" CHECK (
      ("previewTitle" IS NULL OR length("previewTitle") <= 120)
      AND ("previewDescription" IS NULL OR length("previewDescription") <= 300)
      AND ("previewImageUrl" IS NULL OR ("previewImageUrl" LIKE 'https://%' AND length("previewImageUrl") <= 2048))
    );
  END IF;
END $$;

-- 3. Código curto por pessoa.
CREATE TABLE IF NOT EXISTS "TrackedLinkRecipient" (
  "id"          TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
  "workspaceId" TEXT NOT NULL,
  "slug"        TEXT NOT NULL,
  "code"        TEXT NOT NULL CHECK ("code" ~ '^[A-Za-z0-9]{6,8}$'),
  "igUserId"    TEXT NOT NULL CHECK (length("igUserId") BETWEEN 1 AND 64),
  "dmLogId"     TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TrackedLinkRecipient_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TrackedLinkRecipient_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "TrackedLinkRecipient_slug_code_key" ON "TrackedLinkRecipient"("slug", "code");
CREATE UNIQUE INDEX IF NOT EXISTS "TrackedLinkRecipient_slug_igUserId_key" ON "TrackedLinkRecipient"("slug", "igUserId");
CREATE INDEX IF NOT EXISTS "TrackedLinkRecipient_workspaceId_idx" ON "TrackedLinkRecipient"("workspaceId");

-- ===========================================================================
-- RLS (padrão da Fase 0)
--   Quem grava é o sistema: o worker, ao montar a DM (papel le_system,
--   BYPASSRLS). A rota pública /r lê pelo le_system. Membro do workspace
--   ATIVO lê pelo le_app; o admin da plataforma lê. Pelo le_app ninguém grava,
--   edita ou apaga.
-- ===========================================================================
ALTER TABLE public."TrackedLinkRecipient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."TrackedLinkRecipient" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ws_member_read ON public."TrackedLinkRecipient";
CREATE POLICY ws_member_read ON public."TrackedLinkRecipient" FOR SELECT TO PUBLIC
  USING (app.in_current_workspace("workspaceId") OR app.is_admin());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_app') THEN
    GRANT SELECT ON public."TrackedLinkRecipient" TO le_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'le_system') THEN
    GRANT SELECT, INSERT, UPDATE ON public."TrackedLinkRecipient" TO le_system;
  END IF;
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'não deu pra dar as permissões de TrackedLinkRecipient, veja docs/links-e-previa.md';
END $$;
