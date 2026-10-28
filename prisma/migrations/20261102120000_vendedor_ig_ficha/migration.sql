-- Aditiva e segura: 1 coluna nova com padrão vazio + 2 tabelas novas. Nada existente é alterado.
-- Rollback: DROP TABLE IF EXISTS "public"."VendedorIgExemplo"; DROP TABLE IF EXISTS "public"."VendedorIgFicha"; ALTER TABLE "public"."VendedorIgConfig" DROP COLUMN IF EXISTS "licoes";
ALTER TABLE "public"."VendedorIgConfig" ADD COLUMN IF NOT EXISTS "licoes" TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS "public"."VendedorIgFicha" (
  "contactId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "instagramAccountId" TEXT NOT NULL,
  "campos" JSONB NOT NULL DEFAULT '{}',
  "estagio" TEXT NOT NULL DEFAULT 'novo',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VendedorIgFicha_pkey" PRIMARY KEY ("contactId")
);
CREATE INDEX IF NOT EXISTS "VendedorIgFicha_instagramAccountId_updatedAt_idx" ON "public"."VendedorIgFicha"("instagramAccountId", "updatedAt");

CREATE TABLE IF NOT EXISTS "public"."VendedorIgExemplo" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "instagramAccountId" TEXT NOT NULL,
  "origem" TEXT NOT NULL,
  "origemId" TEXT NOT NULL,
  "pergunta" TEXT NOT NULL,
  "rascunho" TEXT,
  "resposta" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VendedorIgExemplo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "VendedorIgExemplo_instagramAccountId_origemId_key" ON "public"."VendedorIgExemplo"("instagramAccountId", "origemId");
CREATE INDEX IF NOT EXISTS "VendedorIgExemplo_instagramAccountId_createdAt_idx" ON "public"."VendedorIgExemplo"("instagramAccountId", "createdAt" DESC);
