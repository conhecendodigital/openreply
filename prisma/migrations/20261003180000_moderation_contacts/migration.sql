-- CreateEnum
CREATE TYPE "ModerationMode" AS ENUM ('OFF', 'OBSERVE', 'HIDE');

-- CreateEnum
CREATE TYPE "ModerationAction" AS ENUM ('NONE', 'WOULD_HIDE', 'HIDDEN', 'RESTORED', 'SKIPPED_PROTECTED', 'FAILED');

-- AlterTable
ALTER TABLE "LinkClick" ADD COLUMN     "contactIgUserId" TEXT,
ADD COLUMN     "dmLogId" TEXT;

-- CreateTable
CREATE TABLE "ModerationSettings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "mode" "ModerationMode" NOT NULL DEFAULT 'OBSERVE',
    "categories" TEXT[] DEFAULT ARRAY['spam_link', 'scam', 'offense']::TEXT[],
    "blockedTerms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedTerms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "useJev" BOOLEAN NOT NULL DEFAULT false,
    "jevMinConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModerationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommentModeration" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "commenterIgId" TEXT NOT NULL,
    "commenterUsername" TEXT,
    "commentText" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "reason" TEXT,
    "matchedRule" TEXT,
    "jevConfidence" DOUBLE PRECISION,
    "action" "ModerationAction" NOT NULL,
    "protectedReason" TEXT,
    "mode" "ModerationMode" NOT NULL,
    "error" TEXT,
    "hiddenAt" TIMESTAMP(3),
    "restoredAt" TIMESTAMP(3),
    "restoredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommentModeration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "username" TEXT,
    "name" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "lastInboundAt" TIMESTAMP(3),
    "commentsCount" INTEGER NOT NULL DEFAULT 0,
    "dmsInCount" INTEGER NOT NULL DEFAULT 0,
    "dmsOutCount" INTEGER NOT NULL DEFAULT 0,
    "campaignsCount" INTEGER NOT NULL DEFAULT 0,
    "clicksCount" INTEGER NOT NULL DEFAULT 0,
    "hiddenCommentsCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactTag" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "refId" TEXT NOT NULL,
    "automationId" TEXT,
    "mediaId" TEXT,
    "text" TEXT,
    "meta" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModerationSettings_instagramAccountId_key" ON "ModerationSettings"("instagramAccountId");

-- CreateIndex
CREATE INDEX "ModerationSettings_workspaceId_idx" ON "ModerationSettings"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "CommentModeration_commentId_key" ON "CommentModeration"("commentId");

-- CreateIndex
CREATE INDEX "CommentModeration_workspaceId_createdAt_idx" ON "CommentModeration"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "CommentModeration_instagramAccountId_action_idx" ON "CommentModeration"("instagramAccountId", "action");

-- CreateIndex
CREATE INDEX "CommentModeration_commenterIgId_idx" ON "CommentModeration"("commenterIgId");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_lastSeenAt_idx" ON "Contact"("workspaceId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_username_idx" ON "Contact"("workspaceId", "username");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_instagramAccountId_igUserId_key" ON "Contact"("instagramAccountId", "igUserId");

-- CreateIndex
CREATE INDEX "ContactTag_workspaceId_name_idx" ON "ContactTag"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ContactTag_contactId_name_key" ON "ContactTag"("contactId", "name");

-- CreateIndex
CREATE INDEX "ContactEvent_contactId_occurredAt_idx" ON "ContactEvent"("contactId", "occurredAt");

-- CreateIndex
CREATE INDEX "ContactEvent_workspaceId_type_occurredAt_idx" ON "ContactEvent"("workspaceId", "type", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContactEvent_contactId_type_refId_key" ON "ContactEvent"("contactId", "type", "refId");

-- CreateIndex
CREATE INDEX "LinkClick_contactIgUserId_idx" ON "LinkClick"("contactIgUserId");

-- AddForeignKey
ALTER TABLE "ModerationSettings" ADD CONSTRAINT "ModerationSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationSettings" ADD CONSTRAINT "ModerationSettings_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentModeration" ADD CONSTRAINT "CommentModeration_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentModeration" ADD CONSTRAINT "CommentModeration_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTag" ADD CONSTRAINT "ContactTag_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactEvent" ADD CONSTRAINT "ContactEvent_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

