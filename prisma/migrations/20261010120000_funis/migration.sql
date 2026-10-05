-- Etapa 6: funis interativos (Quiz). Só aditiva: 1 enum e 5 tabelas novas
-- (Funnel, FunnelVisit, FunnelEvent, FunnelLead, FunnelPurchase), com seus
-- índices e chaves estrangeiras. Nenhuma tabela existente muda, nada é
-- apagado nem reescrito (os índices parciais dos fluxos ficam como estão).
-- Todo funil nasce DRAFT.

-- CreateEnum
CREATE TYPE "FunnelStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "Funnel" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "FunnelStatus" NOT NULL DEFAULT 'DRAFT',
    "draft" JSONB NOT NULL,
    "published" JSONB,
    "publishedVersion" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    "templateId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Funnel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunnelVisit" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "funnelId" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "funnelVersion" INTEGER NOT NULL,
    "contactId" TEXT,
    "tracking" JSONB,
    "source" TEXT NOT NULL,
    "referrerHost" TEXT,
    "device" TEXT,
    "ipHash" TEXT,
    "maxStepIndex" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "checkoutAt" TIMESTAMP(3),
    "leadAt" TIMESTAMP(3),
    "purchasedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FunnelVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunnelEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "funnelId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL DEFAULT '',
    "value" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FunnelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunnelLead" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "funnelId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "contactId" TEXT,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "answers" JSONB NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "consentAt" TIMESTAMP(3),
    "consentText" TEXT,
    "purchasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FunnelLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunnelPurchase" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "funnelId" TEXT,
    "visitId" TEXT,
    "leadId" TEXT,
    "contactId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'hotmart',
    "transaction" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "status" TEXT,
    "productId" TEXT,
    "productName" TEXT,
    "offerCode" TEXT,
    "amountCents" INTEGER,
    "currency" TEXT,
    "buyerEmailHash" TEXT,
    "src" TEXT,
    "sck" TEXT,
    "xcod" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FunnelPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Funnel_slug_key" ON "Funnel"("slug");

-- CreateIndex
CREATE INDEX "Funnel_workspaceId_updatedAt_idx" ON "Funnel"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "FunnelVisit_visitorId_idx" ON "FunnelVisit"("visitorId");

-- CreateIndex
CREATE INDEX "FunnelVisit_funnelId_createdAt_idx" ON "FunnelVisit"("funnelId", "createdAt");

-- CreateIndex
CREATE INDEX "FunnelVisit_funnelId_source_createdAt_idx" ON "FunnelVisit"("funnelId", "source", "createdAt");

-- CreateIndex
CREATE INDEX "FunnelVisit_contactId_idx" ON "FunnelVisit"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "FunnelVisit_funnelId_visitorId_key" ON "FunnelVisit"("funnelId", "visitorId");

-- CreateIndex
CREATE INDEX "FunnelEvent_funnelId_type_createdAt_idx" ON "FunnelEvent"("funnelId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FunnelEvent_visitId_type_stepId_blockId_key" ON "FunnelEvent"("visitId", "type", "stepId", "blockId");

-- CreateIndex
CREATE UNIQUE INDEX "FunnelLead_visitId_key" ON "FunnelLead"("visitId");

-- CreateIndex
CREATE INDEX "FunnelLead_funnelId_createdAt_idx" ON "FunnelLead"("funnelId", "createdAt");

-- CreateIndex
CREATE INDEX "FunnelLead_workspaceId_email_idx" ON "FunnelLead"("workspaceId", "email");

-- CreateIndex
CREATE INDEX "FunnelPurchase_funnelId_occurredAt_idx" ON "FunnelPurchase"("funnelId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "FunnelPurchase_provider_transaction_event_key" ON "FunnelPurchase"("provider", "transaction", "event");

-- AddForeignKey
ALTER TABLE "Funnel" ADD CONSTRAINT "Funnel_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelVisit" ADD CONSTRAINT "FunnelVisit_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "Funnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelVisit" ADD CONSTRAINT "FunnelVisit_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelEvent" ADD CONSTRAINT "FunnelEvent_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "Funnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelEvent" ADD CONSTRAINT "FunnelEvent_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "FunnelVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelLead" ADD CONSTRAINT "FunnelLead_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "Funnel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelLead" ADD CONSTRAINT "FunnelLead_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "FunnelVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelLead" ADD CONSTRAINT "FunnelLead_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelPurchase" ADD CONSTRAINT "FunnelPurchase_funnelId_fkey" FOREIGN KEY ("funnelId") REFERENCES "Funnel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelPurchase" ADD CONSTRAINT "FunnelPurchase_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "FunnelVisit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

