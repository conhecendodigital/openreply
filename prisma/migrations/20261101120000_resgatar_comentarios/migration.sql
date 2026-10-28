-- 28/10/2026: "Resgatar comentários". Só tabelas novas, nada existente muda. Idempotente.
CREATE TABLE IF NOT EXISTS "public"."ResgateRun" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "instagramAccountId" TEXT NOT NULL,
  "flowId" TEXT,
  "automationId" TEXT,
  "mediaId" TEXT NOT NULL,
  "postRef" TEXT,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "intervaloMinMs" INTEGER NOT NULL DEFAULT 2000,
  "intervaloMaxMs" INTEGER NOT NULL DEFAULT 4000,
  "tetoHora" INTEGER NOT NULL DEFAULT 400,
  "pausedUntil" TIMESTAMP(3),
  "pauseReason" TEXT,
  "lastError" TEXT,
  "planSummary" JSONB,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "ResgateRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."ResgateItem" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "commentId" TEXT NOT NULL,
  "igUserId" TEXT NOT NULL,
  "username" TEXT,
  "text" TEXT NOT NULL,
  "commentAt" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "reason" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResgateItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ResgateRun_workspaceId_createdAt_idx" ON "public"."ResgateRun"("workspaceId", "createdAt");
CREATE INDEX IF NOT EXISTS "ResgateRun_status_idx" ON "public"."ResgateRun"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "ResgateItem_runId_commentId_key" ON "public"."ResgateItem"("runId", "commentId");
CREATE INDEX IF NOT EXISTS "ResgateItem_runId_status_idx" ON "public"."ResgateItem"("runId", "status");
CREATE INDEX IF NOT EXISTS "ResgateItem_commentId_idx" ON "public"."ResgateItem"("commentId");

DO $$ BEGIN
  ALTER TABLE "public"."ResgateItem" ADD CONSTRAINT "ResgateItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "public"."ResgateRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
