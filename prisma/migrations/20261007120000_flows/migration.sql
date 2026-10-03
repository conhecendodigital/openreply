-- Etapa 3: fluxos (construtor visual). Só aditiva: tabelas novas, nenhuma
-- coluna de Automation, DmLog, TrackedLink ou ConversationLink muda. Fluxo
-- nasce desligado, então as campanhas ligadas continuam exatamente iguais.

-- CreateEnum
CREATE TYPE "FlowRunStatus" AS ENUM ('ACTIVE', 'WAITING_DELAY', 'WAITING_REPLY', 'WAITING_TAP', 'DONE', 'HANDED_OFF', 'STOPPED_WINDOW', 'STOPPED_TAKEOVER', 'STOPPED_OFF', 'STOPPED_LIMIT', 'FAILED');

-- CreateTable
CREATE TABLE "Flow" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "draft" JSONB NOT NULL,
    "published" JSONB,
    "publishedVersion" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,
    "triggerType" TEXT,
    "triggerPostId" TEXT,
    "triggerMatchAnyPost" BOOLEAN NOT NULL DEFAULT false,
    "triggerStoryId" TEXT,
    "conversationLinkId" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "matchAnyWord" BOOLEAN NOT NULL DEFAULT false,
    "wholeWordMatch" BOOLEAN NOT NULL DEFAULT true,
    "sourceAutomationId" TEXT,
    "enteredCount" INTEGER NOT NULL DEFAULT 0,
    "completedCount" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Flow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "flowVersion" INTEGER NOT NULL,
    "contactId" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "status" "FlowRunStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentNodeId" TEXT,
    "triggerKey" TEXT NOT NULL,
    "triggerCommentId" TEXT,
    "privateReplyUsed" BOOLEAN NOT NULL DEFAULT false,
    "waitingUntil" TIMESTAMP(3),
    "stepCount" INTEGER NOT NULL DEFAULT 0,
    "stopReason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "nodeType" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "detail" TEXT,
    "mid" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "buttonId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "label" TEXT,
    "destinationUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FlowLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowLinkClick" (
    "id" TEXT NOT NULL,
    "flowLinkId" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "runId" TEXT,
    "contactIgUserId" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowLinkClick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Flow_instagramAccountId_isActive_triggerType_idx" ON "Flow"("instagramAccountId", "isActive", "triggerType");

-- CreateIndex
CREATE INDEX "Flow_workspaceId_idx" ON "Flow"("workspaceId");

-- CreateIndex
CREATE INDEX "Flow_conversationLinkId_idx" ON "Flow"("conversationLinkId");

-- CreateIndex
CREATE INDEX "FlowRun_contactId_status_idx" ON "FlowRun"("contactId", "status");

-- CreateIndex
CREATE INDEX "FlowRun_flowId_status_currentNodeId_idx" ON "FlowRun"("flowId", "status", "currentNodeId");

-- CreateIndex
CREATE INDEX "FlowRun_triggerCommentId_idx" ON "FlowRun"("triggerCommentId");

-- CreateIndex
CREATE UNIQUE INDEX "FlowRun_flowId_triggerKey_key" ON "FlowRun"("flowId", "triggerKey");

-- CreateIndex
CREATE INDEX "FlowStep_runId_occurredAt_idx" ON "FlowStep"("runId", "occurredAt");

-- CreateIndex
CREATE INDEX "FlowStep_flowId_nodeId_outcome_idx" ON "FlowStep"("flowId", "nodeId", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "FlowLink_slug_key" ON "FlowLink"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "FlowLink_flowId_nodeId_buttonId_key" ON "FlowLink"("flowId", "nodeId", "buttonId");

-- CreateIndex
CREATE INDEX "FlowLinkClick_flowId_nodeId_idx" ON "FlowLinkClick"("flowId", "nodeId");

-- CreateIndex
CREATE INDEX "FlowLinkClick_runId_idx" ON "FlowLinkClick"("runId");

-- CreateIndex
CREATE INDEX "FlowLinkClick_contactIgUserId_idx" ON "FlowLinkClick"("contactIgUserId");

-- AddForeignKey
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowRun" ADD CONSTRAINT "FlowRun_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowRun" ADD CONSTRAINT "FlowRun_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowStep" ADD CONSTRAINT "FlowStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "FlowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowLink" ADD CONSTRAINT "FlowLink_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowLinkClick" ADD CONSTRAINT "FlowLinkClick_flowLinkId_fkey" FOREIGN KEY ("flowLinkId") REFERENCES "FlowLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- No máximo um run aberto por (fluxo, contato): um toque, uma resposta ou um
-- evento repetido nunca põe a mesma pessoa duas vezes no mesmo fluxo.
CREATE UNIQUE INDEX "FlowRun_one_open_per_contact" ON "FlowRun"("flowId", "contactId") WHERE "status" IN ('ACTIVE', 'WAITING_DELAY', 'WAITING_REPLY', 'WAITING_TAP');
