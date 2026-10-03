-- Etapa 2: rascunhos com aprovação, assumir conversa, sequências em 24 h,
-- links de conversa (ig.me ?ref=) e teto de comentários escondidos por hora.
-- Só aditiva: toda coluna nova em tabela existente tem default ou é opcional.

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('PENDING', 'APPROVED', 'SENT', 'REJECTED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "SequenceStatus" AS ENUM ('ACTIVE', 'DONE', 'STOPPED_REPLY', 'STOPPED_WINDOW', 'STOPPED_TAKEOVER', 'STOPPED_OFF');

-- AlterEnum
ALTER TYPE "DmStatus" ADD VALUE 'SKIPPED_TAKEOVER';

-- AlterTable
ALTER TABLE "ApiToken" ADD COLUMN     "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "InstagramAccount" ADD COLUMN     "takeoverHours" INTEGER NOT NULL DEFAULT 24;

-- AlterTable
ALTER TABLE "ModerationSettings" ADD COLUMN     "maxHidesPerHour" INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE "CommentModeration" ADD COLUMN     "hiddenBy" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "humanTakeover" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "humanTakeoverBy" TEXT,
ADD COLUMN     "humanTakeoverReason" TEXT,
ADD COLUMN     "humanTakeoverUntil" TIMESTAMP(3),
ADD COLUMN     "lastOutboundAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OutboundMessage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "contactIgUserId" TEXT NOT NULL,
    "mid" TEXT,
    "origin" TEXT NOT NULL,
    "refId" TEXT,
    "text" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftReply" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "reason" TEXT,
    "origin" TEXT NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'PENDING',
    "basedOnMid" TEXT,
    "createdBy" TEXT,
    "editedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "approvedVia" TEXT,
    "approvedTokenId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "sentMid" TEXT,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DraftReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceStep" (
    "id" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "delayMinutes" INTEGER NOT NULL,

    CONSTRAINT "SequenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequenceEnrollment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sequenceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastStepOrder" INTEGER NOT NULL DEFAULT 0,
    "waitingReply" BOOLEAN NOT NULL DEFAULT false,
    "status" "SequenceStatus" NOT NULL DEFAULT 'ACTIVE',
    "stoppedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SequenceEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationLink" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "automationId" TEXT,
    "tagName" TEXT,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "opens" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationLinkOpen" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "isNewThread" BOOLEAN NOT NULL DEFAULT false,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationLinkOpen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutboundMessage_mid_key" ON "OutboundMessage"("mid");

-- CreateIndex
CREATE INDEX "OutboundMessage_instagramAccountId_contactIgUserId_createdA_idx" ON "OutboundMessage"("instagramAccountId", "contactIgUserId", "createdAt");

-- CreateIndex
CREATE INDEX "DraftReply_workspaceId_status_createdAt_idx" ON "DraftReply"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DraftReply_contactId_status_idx" ON "DraftReply"("contactId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Sequence_automationId_key" ON "Sequence"("automationId");

-- CreateIndex
CREATE INDEX "Sequence_workspaceId_idx" ON "Sequence"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceStep_sequenceId_order_key" ON "SequenceStep"("sequenceId", "order");

-- CreateIndex
CREATE INDEX "SequenceEnrollment_contactId_status_idx" ON "SequenceEnrollment"("contactId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SequenceEnrollment_sequenceId_contactId_key" ON "SequenceEnrollment"("sequenceId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationLink_code_key" ON "ConversationLink"("code");

-- CreateIndex
CREATE INDEX "ConversationLink_workspaceId_idx" ON "ConversationLink"("workspaceId");

-- CreateIndex
CREATE INDEX "ConversationLink_instagramAccountId_idx" ON "ConversationLink"("instagramAccountId");

-- CreateIndex
CREATE INDEX "ConversationLinkOpen_contactId_idx" ON "ConversationLinkOpen"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationLinkOpen_linkId_eventKey_key" ON "ConversationLinkOpen"("linkId", "eventKey");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_lastInboundAt_idx" ON "Contact"("workspaceId", "lastInboundAt");

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftReply" ADD CONSTRAINT "DraftReply_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftReply" ADD CONSTRAINT "DraftReply_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftReply" ADD CONSTRAINT "DraftReply_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sequence" ADD CONSTRAINT "Sequence_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceStep" ADD CONSTRAINT "SequenceStep_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceEnrollment" ADD CONSTRAINT "SequenceEnrollment_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "Sequence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SequenceEnrollment" ADD CONSTRAINT "SequenceEnrollment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationLink" ADD CONSTRAINT "ConversationLink_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationLink" ADD CONSTRAINT "ConversationLink_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationLink" ADD CONSTRAINT "ConversationLink_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationLinkOpen" ADD CONSTRAINT "ConversationLinkOpen_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ConversationLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationLinkOpen" ADD CONSTRAINT "ConversationLinkOpen_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One pending draft per person, so the AI cannot pile them up. Partial index:
-- Prisma has no syntax for it, so it lives only in this migration.
CREATE UNIQUE INDEX "DraftReply_one_pending_per_contact" ON "DraftReply"("contactId") WHERE "status" = 'PENDING';
