-- Aditiva e segura: 3 tabelas novas. O modo automático nasce DESLIGADO ("enabled" false); nada existente é alterado.
-- Rollback: DROP TABLE IF EXISTS "public"."VendedorIgPerfil"; DROP TABLE IF EXISTS "public"."VendedorIgLog"; DROP TABLE IF EXISTS "public"."VendedorIgConfig";
CREATE TABLE IF NOT EXISTS "public"."VendedorIgConfig" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "instagramAccountId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "enabledAt" TIMESTAMP(3),
  "enabledBy" TEXT,
  "offerFacts" TEXT NOT NULL DEFAULT '',
  "socialProof" TEXT NOT NULL DEFAULT '',
  "minGapSeconds" INTEGER NOT NULL DEFAULT 5,
  "maxPerHour" INTEGER NOT NULL DEFAULT 12,
  "maxPerDay" INTEGER NOT NULL DEFAULT 60,
  "maxPerPersonDay" INTEGER NOT NULL DEFAULT 8,
  "replyDelayMinSec" INTEGER NOT NULL DEFAULT 20,
  "replyDelayMaxSec" INTEGER NOT NULL DEFAULT 90,
  "quietStart" TEXT DEFAULT '23:00',
  "quietEnd" TEXT DEFAULT '07:00',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VendedorIgConfig_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "VendedorIgConfig_instagramAccountId_key" ON "public"."VendedorIgConfig"("instagramAccountId");
ALTER TABLE "public"."VendedorIgConfig" ADD CONSTRAINT "VendedorIgConfig_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "public"."Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."VendedorIgConfig" ADD CONSTRAINT "VendedorIgConfig_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "public"."InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE IF NOT EXISTS "public"."VendedorIgLog" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "instagramAccountId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "inboundMid" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "text" TEXT,
  "parts" INTEGER NOT NULL DEFAULT 0,
  "mids" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "draftId" TEXT,
  "model" TEXT,
  "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VendedorIgLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "VendedorIgLog_instagramAccountId_inboundMid_key" ON "public"."VendedorIgLog"("instagramAccountId", "inboundMid");
CREATE INDEX IF NOT EXISTS "VendedorIgLog_instagramAccountId_createdAt_idx" ON "public"."VendedorIgLog"("instagramAccountId", "createdAt");
CREATE INDEX IF NOT EXISTS "VendedorIgLog_contactId_createdAt_idx" ON "public"."VendedorIgLog"("contactId", "createdAt");

CREATE TABLE IF NOT EXISTS "public"."VendedorIgPerfil" (
  "contactId" TEXT NOT NULL,
  "followerCount" INTEGER,
  "followsUs" BOOLEAN,
  "status" TEXT NOT NULL,
  "fetchedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "VendedorIgPerfil_pkey" PRIMARY KEY ("contactId")
);
