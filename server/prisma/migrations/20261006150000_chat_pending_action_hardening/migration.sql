-- AlterTable
ALTER TABLE "chat_pending_actions" ADD COLUMN "intent" TEXT, ADD COLUMN "interpretation" TEXT, ADD COLUMN "tokenHash" TEXT, ADD COLUMN "resourceVersions" JSONB;
