-- 23/10/2026: a Facebook Page can be connected as a channel. Additive only:
-- every existing row stays INSTAGRAM.
ALTER TABLE "InstagramAccount" ADD COLUMN IF NOT EXISTS "platform" TEXT NOT NULL DEFAULT 'INSTAGRAM';
