-- Etapa 5: escala (disparos pra segmentos, teste A/B, relatórios). Só aditiva:
-- colunas novas com default ou null, tabelas e índices novos. Nada é apagado
-- nem reescrito. Automation.abTestEnabled nasce false, então nenhuma campanha
-- muda de comportamento.

-- CreateEnum
CREATE TYPE "BroadcastStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'DONE', 'CANCELED', 'FAILED');

-- CreateEnum
CREATE TYPE "BroadcastRecipientStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'MAYBE_SENT', 'SKIPPED_WINDOW', 'SKIPPED_TAKEOVER', 'SKIPPED_OPTOUT', 'SKIPPED_CHANNEL', 'SKIPPED_LIMIT', 'SKIPPED_BUSY', 'SKIPPED_CANCELED');

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "abTestEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "abWinnerKey" TEXT;

-- AlterTable
ALTER TABLE "DmLog" ADD COLUMN     "variantKey" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "broadcastOptOutAt" TIMESTAMP(3),
ADD COLUMN     "followsBusiness" BOOLEAN,
ADD COLUMN     "followsCheckedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CampaignVariant" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "openingDmMessage" TEXT,
    "dmMessage" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "winnerAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignVariant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "createdBy" TEXT,
    "createdVia" TEXT NOT NULL DEFAULT 'session',
    "lastCount" INTEGER,
    "lastCountAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Broadcast" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "segmentId" TEXT,
    "filtersSnapshot" JSONB NOT NULL,
    "name" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "buttons" JSONB NOT NULL DEFAULT '[]',
    "variants" JSONB,
    "abWinnerKey" TEXT,
    "skipBusy" BOOLEAN NOT NULL DEFAULT true,
    "status" "BroadcastStatus" NOT NULL DEFAULT 'DRAFT',
    "stopReason" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "canceledBy" TEXT,
    "createdBy" TEXT,
    "createdVia" TEXT NOT NULL DEFAULT 'session',
    "sentBy" TEXT,
    "batchSize" INTEGER NOT NULL DEFAULT 20,
    "pauseSeconds" INTEGER NOT NULL DEFAULT 60,
    "batchSeq" INTEGER NOT NULL DEFAULT 0,
    "nextBatchAt" TIMESTAMP(3),
    "segmentCount" INTEGER NOT NULL DEFAULT 0,
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastRecipient" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "variantKey" TEXT,
    "status" "BroadcastRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "mid" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BroadcastRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "buttonId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT,
    "destinationUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BroadcastLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastLinkClick" (
    "id" TEXT NOT NULL,
    "broadcastLinkId" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "recipientId" TEXT,
    "contactIgUserId" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BroadcastLinkClick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignVariant_automationId_idx" ON "CampaignVariant"("automationId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignVariant_automationId_key_key" ON "CampaignVariant"("automationId", "key");

-- CreateIndex
CREATE INDEX "Segment_workspaceId_idx" ON "Segment"("workspaceId");

-- CreateIndex
CREATE INDEX "Broadcast_workspaceId_status_createdAt_idx" ON "Broadcast"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Broadcast_status_scheduledAt_idx" ON "Broadcast"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "BroadcastRecipient_broadcastId_status_idx" ON "BroadcastRecipient"("broadcastId", "status");

-- CreateIndex
CREATE INDEX "BroadcastRecipient_igUserId_idx" ON "BroadcastRecipient"("igUserId");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastRecipient_broadcastId_contactId_key" ON "BroadcastRecipient"("broadcastId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastLink_slug_key" ON "BroadcastLink"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastLink_broadcastId_buttonId_key" ON "BroadcastLink"("broadcastId", "buttonId");

-- CreateIndex
CREATE INDEX "BroadcastLinkClick_broadcastId_createdAt_idx" ON "BroadcastLinkClick"("broadcastId", "createdAt");

-- CreateIndex
CREATE INDEX "BroadcastLinkClick_contactIgUserId_idx" ON "BroadcastLinkClick"("contactIgUserId");

-- CreateIndex
CREATE INDEX "DmLog_workspaceId_dmSentAt_idx" ON "DmLog"("workspaceId", "dmSentAt");

-- CreateIndex
CREATE INDEX "DmLog_automationId_status_idx" ON "DmLog"("automationId", "status");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_firstSeenAt_idx" ON "Contact"("workspaceId", "firstSeenAt");

-- CreateIndex
CREATE INDEX "ContactTag_workspaceId_createdAt_idx" ON "ContactTag"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_workspaceId_createdAt_idx" ON "OutboundMessage"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "OutboundMessage_workspaceId_origin_createdAt_idx" ON "OutboundMessage"("workspaceId", "origin", "createdAt");

-- CreateIndex
CREATE INDEX "FlowLinkClick_flowId_createdAt_idx" ON "FlowLinkClick"("flowId", "createdAt");

-- AddForeignKey
ALTER TABLE "CampaignVariant" ADD CONSTRAINT "CampaignVariant_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastLink" ADD CONSTRAINT "BroadcastLink_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastLinkClick" ADD CONSTRAINT "BroadcastLinkClick_broadcastLinkId_fkey" FOREIGN KEY ("broadcastLinkId") REFERENCES "BroadcastLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
