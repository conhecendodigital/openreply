-- Aditiva e segura: 3 colunas novas com padrão (retomada desligada). Nada existente é alterado ou apagado.
-- Rollback: ALTER TABLE "public"."VendedorIgConfig" DROP COLUMN IF EXISTS "retomadaEnabled", DROP COLUMN IF EXISTS "retomadaHoras", DROP COLUMN IF EXISTS "retomadaMaxPorHora";
ALTER TABLE "public"."VendedorIgConfig" ADD COLUMN IF NOT EXISTS "retomadaEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "public"."VendedorIgConfig" ADD COLUMN IF NOT EXISTS "retomadaHoras" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "public"."VendedorIgConfig" ADD COLUMN IF NOT EXISTS "retomadaMaxPorHora" INTEGER NOT NULL DEFAULT 6;
