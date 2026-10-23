-- 23/10/2026: posts agendados para YouTube, Instagram (Reels) e Facebook.
-- Aditiva: socialAccountId passa a aceitar nulo e entra channelId (conta de
-- Instagram/Facebook, sem copiar token). Nada existente é apagado. Idempotente.
ALTER TABLE "public"."ScheduledPost" ALTER COLUMN "socialAccountId" DROP NOT NULL;
ALTER TABLE "public"."ScheduledPost" ADD COLUMN IF NOT EXISTS "channelId" TEXT;

CREATE INDEX IF NOT EXISTS "ScheduledPost_channelId_idx" ON "public"."ScheduledPost"("channelId");

DO $$ BEGIN
  ALTER TABLE "public"."ScheduledPost" ADD CONSTRAINT "ScheduledPost_channelId_fkey"
    FOREIGN KEY ("channelId") REFERENCES "public"."InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
