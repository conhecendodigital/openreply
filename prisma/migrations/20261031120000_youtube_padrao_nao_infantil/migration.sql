-- Aditiva e segura: colunas novas com padrão (desligado); nada é apagado nem reescrito.
-- Rollback: ALTER TABLE "public"."SocialAccount" DROP COLUMN IF EXISTS "youtubeNotForKidsDefault", DROP COLUMN IF EXISTS "youtubeNotForKidsDefaultAt", DROP COLUMN IF EXISTS "youtubeNotForKidsDefaultBy";
ALTER TABLE "public"."SocialAccount" ADD COLUMN IF NOT EXISTS "youtubeNotForKidsDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "public"."SocialAccount" ADD COLUMN IF NOT EXISTS "youtubeNotForKidsDefaultAt" TIMESTAMP(3);
ALTER TABLE "public"."SocialAccount" ADD COLUMN IF NOT EXISTS "youtubeNotForKidsDefaultBy" TEXT;
