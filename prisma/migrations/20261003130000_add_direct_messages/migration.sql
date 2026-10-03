-- CreateTable
CREATE TABLE "DirectMessage" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT,
    "accountId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "mid" TEXT NOT NULL,
    "fromMe" BOOLEAN NOT NULL,
    "text" TEXT,
    "template" JSONB,
    "storyReply" BOOLEAN NOT NULL DEFAULT false,
    "deleted" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DirectMedia" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "mime" TEXT,
    "size" INTEGER,
    "data" BYTEA,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "savedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DirectMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DirectMessage_mid_key" ON "DirectMessage"("mid");

-- CreateIndex
CREATE INDEX "DirectMessage_accountId_contactId_sentAt_idx" ON "DirectMessage"("accountId", "contactId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "DirectMedia_messageId_position_key" ON "DirectMedia"("messageId", "position");

-- AddForeignKey
ALTER TABLE "DirectMedia" ADD CONSTRAINT "DirectMedia_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "DirectMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
