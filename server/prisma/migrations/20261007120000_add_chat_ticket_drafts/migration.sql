-- CreateTable
CREATE TABLE "chat_ticket_drafts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "step" TEXT NOT NULL DEFAULT 'TITLE',
    "fields" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_ticket_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_draft_attachments" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_draft_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_ticket_drafts_userId_conversationId_status_idx" ON "chat_ticket_drafts"("userId", "conversationId", "status");

-- CreateIndex
CREATE INDEX "chat_draft_attachments_draftId_idx" ON "chat_draft_attachments"("draftId");

-- AddForeignKey
ALTER TABLE "chat_ticket_drafts" ADD CONSTRAINT "chat_ticket_drafts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_draft_attachments" ADD CONSTRAINT "chat_draft_attachments_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "chat_ticket_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
