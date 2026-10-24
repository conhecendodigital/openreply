-- 23/10/2026: contas de rede social (TikTok) e posts agendados. Só tabelas
-- novas, nada existente muda. Idempotente.
DO $$ BEGIN
  CREATE TYPE "public"."SocialAccountStatus" AS ENUM ('ACTIVE', 'NEEDS_RECONNECT', 'DISCONNECTED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "public"."ScheduledPostStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "public"."SocialAccount" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "platform" TEXT NOT NULL DEFAULT 'TIKTOK',
  "externalId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "username" TEXT,
  "avatarUrl" TEXT,
  "accessToken" TEXT NOT NULL,
  "refreshToken" TEXT,
  "tokenExpiresAt" TIMESTAMP(3),
  "refreshExpiresAt" TIMESTAMP(3),
  "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "status" "public"."SocialAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "lastError" TEXT,
  "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disconnectedAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."ScheduledPost" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "socialAccountId" TEXT NOT NULL,
  "platform" TEXT NOT NULL DEFAULT 'TIKTOK',
  "status" "public"."ScheduledPostStatus" NOT NULL DEFAULT 'DRAFT',
  "caption" TEXT NOT NULL DEFAULT '',
  "mediaUrl" TEXT NOT NULL,
  "mediaBytes" INTEGER NOT NULL,
  "mediaContentType" TEXT NOT NULL,
  "settings" JSONB NOT NULL,
  "scheduledAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "publishId" TEXT,
  "lockedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdVia" TEXT NOT NULL DEFAULT 'UI',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ScheduledPost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SocialAccount_platform_externalId_key" ON "public"."SocialAccount"("platform", "externalId");
CREATE INDEX IF NOT EXISTS "SocialAccount_workspaceId_idx" ON "public"."SocialAccount"("workspaceId");
CREATE INDEX IF NOT EXISTS "ScheduledPost_workspaceId_status_idx" ON "public"."ScheduledPost"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "ScheduledPost_status_scheduledAt_idx" ON "public"."ScheduledPost"("status", "scheduledAt");

DO $$ BEGIN
  ALTER TABLE "public"."SocialAccount" ADD CONSTRAINT "SocialAccount_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."ScheduledPost" ADD CONSTRAINT "ScheduledPost_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "public"."ScheduledPost" ADD CONSTRAINT "ScheduledPost_socialAccountId_fkey"
    FOREIGN KEY ("socialAccountId") REFERENCES "public"."SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
